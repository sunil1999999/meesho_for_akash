import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {},
  supabaseUrl: 'https://mock.supabase.co',
  supabaseAnonKey: 'mock-key',
  reconfigureSupabase: vi.fn(),
}));

import {
  refreshSingleAccountSession,
  validateRefreshedSession,
} from '../lib/accountRefreshService';
import { StorageService } from '../lib/storageAdapter';
import { AccountRecord } from '../types';

describe('Account-Level JSON Refresh Feature Suite', () => {
  let accountA: AccountRecord;
  let accountB: AccountRecord;

  beforeEach(async () => {
    vi.restoreAllMocks();
    (StorageService as any).ensureInitialized();

    accountA = await StorageService.insertAccount({
      phone_normalized: '9033807401',
      phone_display: '+91 90338 07401',
      account_json: {
        mobile: '9033807401',
        user_id: 'usr_alpha_123',
        xo: 'old_xo_token_alpha.valid_part',
        ox: 'old_ox_token_alpha',
        instance_id: 'inst_alpha_01',
        identity: {
          device_model: 'Pixel 8',
          os_version: 'Android 14',
        },
        profile: {
          name: 'Alpha User',
          email: 'alpha@example.com',
        },
        custom_config: {
          loyalty_points: 500,
          preference: 'cod_preferred',
        },
      },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });

    accountB = await StorageService.insertAccount({
      phone_normalized: '9820192831',
      phone_display: '+91 98201 92831',
      account_json: {
        mobile: '9820192831',
        user_id: 'usr_beta_456',
        xo: 'old_xo_token_beta.valid_part',
        ox: 'old_ox_token_beta',
        instance_id: 'inst_beta_02',
        profile: {
          name: 'Beta User',
        },
      },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });
  });

  it('1. refreshes only the selected account and preserves other accounts unchanged', async () => {
    const resultA = await refreshSingleAccountSession(accountA);

    expect(resultA.success).toBe(true);
    expect(resultA.status).toBe('SUCCESS');
    expect(resultA.display_status).toBe('Success');
    expect(resultA.account_id).toBe(accountA.id);

    // Verify Account A was updated in storage
    const updatedA = await StorageService.getAccountById(accountA.id);
    expect(updatedA).not.toBeNull();
    expect(updatedA!.account_json.xo).not.toBe(accountA.account_json.xo);
    expect(updatedA!.account_json.xo).toContain('renewed_xo');
    expect(updatedA!.account_json.refresh_status).toBe('ACTIVE');

    // Verify Account B remained 100% UNTOUCHED
    const untouchedB = await StorageService.getAccountById(accountB.id);
    expect(untouchedB).not.toBeNull();
    expect(untouchedB!.account_json.xo).toBe('old_xo_token_beta.valid_part');
    expect(untouchedB!.account_json.ox).toBe('old_ox_token_beta');
    expect(untouchedB!.account_json.user_id).toBe('usr_beta_456');
  });

  it('2. preserves all unrelated custom fields, profile, and identity data during refresh', async () => {
    const result = await refreshSingleAccountSession(accountA);
    expect(result.success).toBe(true);

    const saved = await StorageService.getAccountById(accountA.id);
    expect(saved).not.toBeNull();

    // Verify nested profile & identity are intact
    expect(saved!.account_json.profile.name).toBe('Alpha User');
    expect(saved!.account_json.profile.email).toBe('alpha@example.com');
    expect(saved!.account_json.identity.device_model).toBe('Pixel 8');
    expect(saved!.account_json.identity.os_version).toBe('Android 14');

    // Verify custom fields are intact
    expect(saved!.account_json.custom_config.loyalty_points).toBe(500);
    expect(saved!.account_json.custom_config.preference).toBe('cod_preferred');
  });

  it('3. validates refreshed session and rejects incomplete refresh responses', () => {
    const original = {
      xo: 'old_xo',
      ox: 'old_ox',
      profile: { name: 'Test' },
      identity: { os: 'Android' },
    };

    // Missing xo
    expect(validateRefreshedSession(original, { ox: 'new_ox' })).toBe(false);

    // Empty xo
    expect(validateRefreshedSession(original, { xo: '   ', ox: 'new_ox' })).toBe(false);

    // Stripped profile
    expect(validateRefreshedSession(original, { xo: 'valid_xo_12345', identity: { os: 'Android' } })).toBe(false);

    // Stripped identity
    expect(validateRefreshedSession(original, { xo: 'valid_xo_12345', profile: { name: 'Test' } })).toBe(false);

    // Valid refreshed session
    expect(
      validateRefreshedSession(original, {
        xo: 'valid_renewed_xo_token.part2',
        ox: 'new_ox',
        profile: { name: 'Test' },
        identity: { os: 'Android' },
      })
    ).toBe(true);
  });

  it('4. displays "Re-login Required" when account requires OTP or re-authentication and preserves original JSON', async () => {
    const otpAccount = await StorageService.insertAccount({
      phone_normalized: '9999900001',
      phone_display: '+91 99999 00001',
      account_json: {
        mobile: '9999900001_reauth',
        xo: 'original_xo_before_otp',
        ox: 'reauth_needed_ox',
        original_secret: 'do_not_erase',
      },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });

    const result = await refreshSingleAccountSession(otpAccount);

    expect(result.success).toBe(false);
    expect(result.status).toBe('REQUIRES_REAUTH');
    expect(result.display_status).toBe('Re-login Required');
    expect(result.message).toContain('OTP');

    // Verify original JSON was PRESERVED and NOT overwritten
    const checkAcc = await StorageService.getAccountById(otpAccount.id);
    expect(checkAcc!.account_json.xo).toBe('original_xo_before_otp');
    expect(checkAcc!.account_json.original_secret).toBe('do_not_erase');
  });

  it('5. displays "Re-login Required" when account session has expired or been revoked', async () => {
    const expiredAccount = await StorageService.insertAccount({
      phone_normalized: '9999900002',
      phone_display: '+91 99999 00002',
      account_json: {
        mobile: '9999900002_expired',
        xo: 'expired_token',
        ox: 'expired_ox',
      },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });

    const result = await refreshSingleAccountSession(expiredAccount);

    expect(result.success).toBe(false);
    expect(result.status).toBe('EXPIRED');
    expect(result.display_status).toBe('Re-login Required');
    expect(result.message).toContain('expired');

    // Original JSON must be preserved
    const checkAcc = await StorageService.getAccountById(expiredAccount.id);
    expect(checkAcc!.account_json.xo).toBe('expired_token');
  });

  it('6. displays "Failed" when tokens are invalid or missing without corrupting account data', async () => {
    const invalidAccount = await StorageService.insertAccount({
      phone_normalized: '9999900003',
      phone_display: '+91 99999 00003',
      account_json: {
        mobile: '9999900003_invalid',
        xo: '',
        ox: '',
      },
      record_status: 'active',
      tags: [],
      is_archived: false,
    });

    const result = await refreshSingleAccountSession(invalidAccount);

    expect(result.success).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.display_status).toBe('Failed');
  });

  it('7. prevents duplicate concurrent refreshes on the same account', async () => {
    const p1 = refreshSingleAccountSession(accountA);
    const p2 = refreshSingleAccountSession(accountA);

    const [res1, res2] = await Promise.all([p1, p2]);

    if (res1.success) {
      expect(res2.success).toBe(false);
      expect(res2.message).toContain('already in progress');
    } else {
      expect(res2.success).toBe(true);
    }
  });
});
