import { describe, it, expect } from 'vitest';
import { getTokenHealth, extractTokenExpiry } from '../lib/tokenHealth';

describe('Token Health & Expiry Sentinel', () => {
  it('returns no_token when accountJson is null or missing xo token', () => {
    expect(getTokenHealth(null).status).toBe('no_token');
    expect(getTokenHealth({}).status).toBe('no_token');
    expect(getTokenHealth({ mobile: '9876543210' }).status).toBe('no_token');
  });

  it('correctly extracts exp timestamp from explicit xo_exp property', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600 * 48; // 2 days in future
    const exp = extractTokenExpiry({ xo: 'dummy.jwt', xo_exp: futureExp });
    expect(exp).toBe(futureExp);

    const health = getTokenHealth({ xo: 'dummy.jwt', xo_exp: futureExp });
    expect(health.status).toBe('active');
    expect(health.label).toContain('Active');
  });

  it('flags tokens expiring in less than 24 hours as expiring_soon', () => {
    const soonExp = Math.floor(Date.now() / 1000) + 3600 * 5; // 5 hours in future
    const health = getTokenHealth({ xo: 'dummy.jwt', xo_exp: soonExp });
    expect(health.status).toBe('expiring_soon');
    expect(health.label).toContain('Expiring in');
  });

  it('flags tokens expired in the past as expired', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600 * 10; // 10 hours ago
    const health = getTokenHealth({ xo: 'dummy.jwt', xo_exp: pastExp });
    expect(health.status).toBe('expired');
    expect(health.label).toContain('Expired');
  });
});
