import { describe, it, expect } from 'vitest';
import {
  normalizePhoneNumber,
  extractPhoneFromAccountJson,
  extractUserIdFromAccountJson,
  matchesMobileNumber,
} from '../lib/phoneUtils';

describe('Phone Number Normalization & Extraction', () => {
  it('normalizes 10-digit Indian numbers starting with 6-9', () => {
    const res = normalizePhoneNumber('9033807401');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('+919033807401');
    expect(res.display).toBe('+91 90338 07401');
  });

  it('normalizes +91 prefixed Indian numbers', () => {
    const res = normalizePhoneNumber('+919033807401');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('+919033807401');
  });

  it('normalizes leading zero numbers (e.g. 09033807401)', () => {
    const res = normalizePhoneNumber('09033807401');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('+919033807401');
  });

  it('normalizes numbers with spaces, dashes, parentheses', () => {
    const res = normalizePhoneNumber('+91 (90338) 07401');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('+919033807401');
  });

  it('rejects invalid numbers and does not hallucinate country codes', () => {
    const res1 = normalizePhoneNumber('12345');
    expect(res1.isValid).toBe(false);
    expect(res1.error).toBeDefined();

    const res2 = normalizePhoneNumber('');
    expect(res2.isValid).toBe(false);

    const res3 = normalizePhoneNumber(null);
    expect(res3.isValid).toBe(false);
  });

  it('extracts phone from arbitrary JSON objects', () => {
    const obj1 = { mobile: '9033807401', user_id: 'u1' };
    expect(extractPhoneFromAccountJson(obj1).normalized).toBe('+919033807401');

    const obj2 = { phone: '+919820192831' };
    expect(extractPhoneFromAccountJson(obj2).normalized).toBe('+919820192831');

    const obj3 = { user: { phone: '9123456780' } };
    expect(extractPhoneFromAccountJson(obj3).normalized).toBe('+919123456780');
  });

  it('extracts user ID from arbitrary JSON objects', () => {
    expect(extractUserIdFromAccountJson({ user_id: 'usr_123' })).toBe('usr_123');
    expect(extractUserIdFromAccountJson({ identity: { user_id: 'usr_ident' } })).toBe('usr_ident');
    expect(extractUserIdFromAccountJson({})).toBeUndefined();
  });
});

describe('Customer Mobile Number Search & Flexible Format Matching', () => {
  const targetPhone = '+91 90338 07401';

  it('matches complete 10-digit mobile number', () => {
    expect(matchesMobileNumber(targetPhone, '9033807401')).toBe(true);
  });

  it('matches full number with +91 country code and spaces', () => {
    expect(matchesMobileNumber(targetPhone, '+91 90338 07401')).toBe(true);
    expect(matchesMobileNumber(targetPhone, '+919033807401')).toBe(true);
    expect(matchesMobileNumber(targetPhone, '919033807401')).toBe(true);
  });

  it('matches number with leading zero trunk prefix', () => {
    expect(matchesMobileNumber(targetPhone, '09033807401')).toBe(true);
    expect(matchesMobileNumber(targetPhone, '090338')).toBe(true);
  });

  it('matches partial mobile numbers (first 5 digits, last 5 digits, infix)', () => {
    expect(matchesMobileNumber(targetPhone, '90338')).toBe(true);
    expect(matchesMobileNumber(targetPhone, '07401')).toBe(true);
    expect(matchesMobileNumber(targetPhone, '338074')).toBe(true);
  });

  it('matches numbers with hyphens, parentheses, or dots', () => {
    expect(matchesMobileNumber(targetPhone, '90338-07401')).toBe(true);
    expect(matchesMobileNumber(targetPhone, '+91 (90338) 07401')).toBe(true);
    expect(matchesMobileNumber(targetPhone, '90338.07401')).toBe(true);
  });

  it('matches when stored phone has no country code', () => {
    const rawNumber = '9820192831';
    expect(matchesMobileNumber(rawNumber, '+91 98201 92831')).toBe(true);
    expect(matchesMobileNumber(rawNumber, '+919820192831')).toBe(true);
    expect(matchesMobileNumber(rawNumber, '09820192831')).toBe(true);
    expect(matchesMobileNumber(rawNumber, '98201')).toBe(true);
  });

  it('strictly rejects non-matching numbers and invalid queries', () => {
    expect(matchesMobileNumber(targetPhone, '9999999999')).toBe(false);
    expect(matchesMobileNumber(targetPhone, '98201')).toBe(false);
    expect(matchesMobileNumber(targetPhone, '')).toBe(false);
    expect(matchesMobileNumber(targetPhone, '   ')).toBe(false);
    expect(matchesMobileNumber(null, '9033807401')).toBe(false);
    expect(matchesMobileNumber(undefined, '9033807401')).toBe(false);
    expect(matchesMobileNumber(targetPhone, null as any)).toBe(false);
  });
});
