import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {},
  supabaseUrl: 'https://mock.supabase.co',
  supabaseAnonKey: 'mock-key',
  reconfigureSupabase: vi.fn(),
}));

import { StorageService } from '../lib/storageAdapter';
import {
  getSavedAddresses,
  clearSavedAddresses,
  getPresetAddresses,
  savePresetAddress,
  getAllKnownAddresses,
  getAccountAssignedAddress,
} from '../lib/addressStorage';
import { DeliveryAddress } from '../types';

let phoneCounter = 1000;
function createTestPhone(): { raw: string; normalized: string; display: string } {
  const num = `99${Date.now().toString().slice(-5)}${phoneCounter++}`;
  return {
    raw: num,
    normalized: `+91${num}`,
    display: `+91 ${num.slice(0, 5)} ${num.slice(5)}`,
  };
}

describe('Manual Address Selection & Account Import Isolation', () => {
  beforeEach(() => {
    clearSavedAddresses();
  });

  const addressA: DeliveryAddress = {
    id: 0,
    local_id: 'test_addr_a',
    name: 'Rohan Sharma',
    mobile: '9876543210',
    address_line_1: 'Flat 101, Galaxy Heights',
    city: 'Surat',
    state: 'Gujarat',
    pin: '395007',
    address_type: 'Home',
    is_upstream_registered: false,
  };

  const addressB: DeliveryAddress = {
    id: 0,
    local_id: 'test_addr_b',
    name: 'Priya Patel',
    mobile: '9823456789',
    address_line_1: '12, Shanti Nagar',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pin: '380015',
    address_type: 'Home',
    is_upstream_registered: false,
  };

  it('1. Import account 1 with Address A: only account 1 receives Address A', async () => {
    const p1 = createTestPhone();
    const importRes = await StorageService.saveBatchAccounts([
      {
        raw_json: { mobile: p1.raw, xo: 'token_1' },
        normalized_phone: p1.normalized,
        display_phone: p1.display,
        selected_address: addressA,
      },
    ]);

    expect(importRes.inserted).toBe(1);
    const acc1 = importRes.records[0];
    expect(acc1).toBeDefined();

    // Verify Address A is assigned to account 1
    const addrAcc1 = getAccountAssignedAddress(acc1);
    expect(addrAcc1).not.toBeNull();
    expect(addrAcc1?.name).toBe('Rohan Sharma');
    expect(addrAcc1?.city).toBe('Surat');
    expect(addrAcc1?.pin).toBe('395007');

    // Also verify saved addresses by ID
    const savedAddrs = getSavedAddresses(acc1.id);
    expect(savedAddrs).toHaveLength(1);
    expect(savedAddrs[0].name).toBe('Rohan Sharma');
  });

  it('2. Import account 2 with Address B: account 1 remains unchanged with Address A', async () => {
    const p1 = createTestPhone();
    const p2 = createTestPhone();

    // Import Account 1 with Address A
    const res1 = await StorageService.saveBatchAccounts([
      {
        raw_json: { mobile: p1.raw, xo: 'token_acct1' },
        normalized_phone: p1.normalized,
        display_phone: p1.display,
        selected_address: addressA,
      },
    ]);
    const acc1 = res1.records[0];

    // Import Account 2 with Address B
    const res2 = await StorageService.saveBatchAccounts([
      {
        raw_json: { mobile: p2.raw, xo: 'token_acct2' },
        normalized_phone: p2.normalized,
        display_phone: p2.display,
        selected_address: addressB,
      },
    ]);
    const acc2 = res2.records[0];

    // Verify Account 2 has Address B
    const addrAcc2 = getAccountAssignedAddress(acc2);
    expect(addrAcc2).not.toBeNull();
    expect(addrAcc2?.name).toBe('Priya Patel');
    expect(addrAcc2?.city).toBe('Ahmedabad');

    // Verify Account 1 still has Address A (strictly untouched and isolated)
    const addrAcc1After = getAccountAssignedAddress(acc1);
    expect(addrAcc1After).not.toBeNull();
    expect(addrAcc1After?.name).toBe('Rohan Sharma');
    expect(addrAcc1After?.city).toBe('Surat');
    expect(getSavedAddresses(acc1.id)[0].name).toBe('Rohan Sharma');
    expect(getSavedAddresses(acc2.id)[0].name).toBe('Priya Patel');
  });

  it('3. Import an account with "No Address": no address is assigned', async () => {
    const p = createTestPhone();
    const res = await StorageService.saveBatchAccounts([
      {
        raw_json: { mobile: p.raw, xo: 'token_no_addr' },
        normalized_phone: p.normalized,
        display_phone: p.display,
        selected_address: null, // User selected "No Address"
      },
    ]);

    expect(res.inserted).toBe(1);
    const acc = res.records[0];
    const assigned = getAccountAssignedAddress(acc);
    expect(assigned).toBeNull();
    expect(getSavedAddresses(acc.id)).toEqual([]);
  });

  it('4. Bulk import applies addresses separately per account and never broadcasts one address across all accounts', async () => {
    const b1Phone = createTestPhone();
    const b2Phone = createTestPhone();
    const b3Phone = createTestPhone();

    const bulkRes = await StorageService.saveBatchAccounts([
      {
        raw_json: { mobile: b1Phone.raw, xo: 'bulk_1' },
        normalized_phone: b1Phone.normalized,
        display_phone: b1Phone.display,
        selected_address: addressA, // Account 1 gets Address A
      },
      {
        raw_json: { mobile: b2Phone.raw, xo: 'bulk_2' },
        normalized_phone: b2Phone.normalized,
        display_phone: b2Phone.display,
        selected_address: null, // Account 2 gets No Address
      },
      {
        raw_json: { mobile: b3Phone.raw, xo: 'bulk_3' },
        normalized_phone: b3Phone.normalized,
        display_phone: b3Phone.display,
        selected_address: addressB, // Account 3 gets Address B
      },
    ]);

    expect(bulkRes.inserted).toBe(3);
    const [b1, b2, b3] = bulkRes.records;

    expect(getAccountAssignedAddress(b1)?.name).toBe('Rohan Sharma');
    expect(getAccountAssignedAddress(b2)).toBeNull();
    expect(getAccountAssignedAddress(b3)?.name).toBe('Priya Patel');
  });

  it('5. Existing accounts retain their addresses when duplicate accounts are processed with skip strategy', async () => {
    const p = createTestPhone();

    // Initial import of existing account with Address A
    const initial = await StorageService.saveBatchAccounts([
      {
        raw_json: { mobile: p.raw, xo: 'token_init' },
        normalized_phone: p.normalized,
        display_phone: p.display,
        selected_address: addressA,
      },
    ]);
    const existing = initial.records[0];

    // Second import attempts to re-import the same number with Address B under skip strategy
    const secondImport = await StorageService.saveBatchAccounts(
      [
        {
          raw_json: { mobile: p.raw, xo: 'token_dup' },
          normalized_phone: p.normalized,
          display_phone: p.display,
          selected_address: addressB,
        },
      ],
      'skip'
    );

    expect(secondImport.skipped).toBe(1);
    // Existing account must retain original Address A
    const current = getAccountAssignedAddress(existing);
    expect(current?.name).toBe('Rohan Sharma');
    expect(current?.city).toBe('Surat');
  });

  it('6. Allows manual address change and removal via assignAccountAddress', async () => {
    const p = createTestPhone();
    const res = await StorageService.saveBatchAccounts([
      {
        raw_json: { mobile: p.raw, xo: 'token_manual' },
        normalized_phone: p.normalized,
        display_phone: p.display,
        selected_address: null,
      },
    ]);
    const acc = res.records[0];
    expect(getAccountAssignedAddress(acc)).toBeNull();

    // Explicitly assign Address B
    await StorageService.assignAccountAddress(acc.id, addressB);
    expect(getAccountAssignedAddress(acc)?.name).toBe('Priya Patel');

    // Explicitly change to Address A
    await StorageService.assignAccountAddress(acc.id, addressA);
    expect(getAccountAssignedAddress(acc)?.name).toBe('Rohan Sharma');

    // Explicitly remove address
    await StorageService.assignAccountAddress(acc.id, null);
    expect(getAccountAssignedAddress(acc)).toBeNull();
  });

  it('7. Preset address library supports retrieval, adding new presets, and listing all known addresses', () => {
    const initialPresets = getPresetAddresses();
    expect(initialPresets.length).toBeGreaterThanOrEqual(1);

    const newPreset = savePresetAddress({
      name: 'Test Preset User',
      mobile: '9811122233',
      address_line_1: '100 Feet Ring Road',
      city: 'Delhi',
      state: 'Delhi',
      pin: '110001',
    });

    expect(newPreset.local_id).toBeDefined();
    const allKnown = getAllKnownAddresses();
    expect(allKnown.some(a => a.name === 'Test Preset User')).toBe(true);
  });
});
