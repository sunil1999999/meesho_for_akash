/**
 * Phone Number Utilities for Meesho Management Dashboard
 * 
 * Normalization Rules:
 * - Detects Indian 10-digit mobile numbers (starting with 6, 7, 8, 9).
 * - Standardizes variations:
 *     - '9033807401' -> '+919033807401'
 *     - '+919033807401' -> '+919033807401'
 *     - '09033807401' -> '+919033807401'
 *     - '919033807401' -> '+919033807401'
 *     - '+91 90338-07401' -> '+919033807401'
 * - Displays in standard readable format: '+91 90338 07401' or '+91XXXXXXXXXX'
 * - Preserves other valid E.164 numbers if country code is explicitly provided
 * - Strictly avoids guessing country codes for ambiguous numbers
 */

export interface PhoneParseResult {
  isValid: boolean;
  normalized: string; // E.164 formatted string
  display: string;    // Human-readable formatted string
  rawExtracted: string;
  error?: string;
}

/**
 * Normalizes a raw phone string into standard E.164 and display formats.
 */
export function normalizePhoneNumber(rawInput: any): PhoneParseResult {
  if (rawInput === null || rawInput === undefined) {
    return {
      isValid: false,
      normalized: '',
      display: 'Missing Number',
      rawExtracted: '',
      error: 'Phone number is null or undefined',
    };
  }

  const rawStr = String(rawInput).trim();
  if (!rawStr) {
    return {
      isValid: false,
      normalized: '',
      display: 'Empty Number',
      rawExtracted: '',
      error: 'Phone number is empty string',
    };
  }

  // Remove whitespace, hyphens, parentheses, dots
  let cleaned = rawStr.replace(/[\s\-\(\)\.]/g, '');

  // Check if starts with '+'
  const hasPlus = cleaned.startsWith('+');
  if (hasPlus) {
    cleaned = cleaned.substring(1);
  }

  // Check for Indian mobile number patterns
  // 1. 10 digits starting with 6, 7, 8, 9
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    const normalized = `+91${cleaned}`;
    const display = `+91 ${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
    return {
      isValid: true,
      normalized,
      display,
      rawExtracted: rawStr,
    };
  }

  // 2. 11 digits starting with 0 followed by 6, 7, 8, 9 (e.g. 09033807401)
  if (/^0[6-9]\d{9}$/.test(cleaned)) {
    const tenDigits = cleaned.substring(1);
    const normalized = `+91${tenDigits}`;
    const display = `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;
    return {
      isValid: true,
      normalized,
      display,
      rawExtracted: rawStr,
    };
  }

  // 3. 12 digits starting with 91 followed by 6, 7, 8, 9 (e.g. 919033807401 or +919033807401)
  if (/^91[6-9]\d{9}$/.test(cleaned)) {
    const tenDigits = cleaned.substring(2);
    const normalized = `+91${tenDigits}`;
    const display = `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}`;
    return {
      isValid: true,
      normalized,
      display,
      rawExtracted: rawStr,
    };
  }

  // Check if international E.164 with explicit '+'
  if (hasPlus && /^\d{7,15}$/.test(cleaned)) {
    const normalized = `+${cleaned}`;
    return {
      isValid: true,
      normalized,
      display: normalized,
      rawExtracted: rawStr,
    };
  }

  // Invalid or ambiguous number
  return {
    isValid: false,
    normalized: cleaned ? `+${cleaned}` : '',
    display: rawStr,
    rawExtracted: rawStr,
    error: `Invalid mobile number format: '${rawStr}'. Indian mobile numbers must be 10 digits starting with 6-9.`,
  };
}

/**
 * Extracts phone or mobile number from an arbitrary account JSON object
 * Searches common keys: mobile, phone, phoneNumber, mobile_no, contact, user.phone, etc.
 */
export function extractPhoneFromAccountJson(accountJson: any): PhoneParseResult {
  if (!accountJson || typeof accountJson !== 'object') {
    return {
      isValid: false,
      normalized: '',
      display: 'Invalid JSON',
      rawExtracted: '',
      error: 'Account record is not a valid JSON object',
    };
  }

  // Check common properties in priority order
  const candidates = [
    accountJson.mobile,
    accountJson.phone,
    accountJson.mobile_number,
    accountJson.mobileNumber,
    accountJson.phone_number,
    accountJson.phoneNumber,
    accountJson.phone_no,
    accountJson.contact,
    accountJson.user?.mobile,
    accountJson.user?.phone,
    accountJson.user?.phoneNumber,
    accountJson.profile?.mobile,
    accountJson.profile?.phone,
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
      return normalizePhoneNumber(candidate);
    }
  }

  return {
    isValid: false,
    normalized: '',
    display: 'Missing Phone',
    rawExtracted: '',
    error: 'No phone or mobile field found in account JSON',
  };
}

/**
 * Extracts a candidate user ID or identity reference from account JSON
 */
export function extractUserIdFromAccountJson(accountJson: any): string | undefined {
  if (!accountJson || typeof accountJson !== 'object') return undefined;

  const candidates = [
    accountJson.user_id,
    accountJson.userId,
    accountJson.id,
    accountJson.identifier,
    accountJson.identity?.user_id,
    accountJson.identity?.id,
    accountJson.user?.id,
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
      return String(candidate);
    }
  }

  return undefined;
}

/**
 * Matches a mobile number against a search query.
 * Supports:
 * - Complete 10-digit mobile number (e.g. '9033807401')
 * - Numbers with country code (e.g. '+919033807401', '+91 90338 07401')
 * - Partial numbers (e.g. '90338', '07401', '807')
 * - Formatted numbers with spaces, dashes, parentheses (e.g. '90338-07401', '(90338) 07401')
 * - Numbers with leading zero trunk prefix (e.g. '09033807401')
 */
export function matchesMobileNumber(phone: string | undefined | null, query: string | undefined | null): boolean {
  if (!phone || !query) return false;
  const cleanQuery = String(query).trim();
  if (!cleanQuery) return false;

  const rawPhone = String(phone).toLowerCase();
  const rawQuery = cleanQuery.toLowerCase();

  // 1. Direct or substring match on raw formatted string
  if (rawPhone.includes(rawQuery)) return true;

  // 2. Digits-only matching
  const queryDigits = cleanQuery.replace(/\D/g, '');
  const phoneDigits = String(phone).replace(/\D/g, '');

  if (queryDigits.length > 0 && phoneDigits.length > 0) {
    // Direct inclusion of digits
    if (phoneDigits.includes(queryDigits)) return true;

    // Handle leading zero trunk prefix in query (e.g. 09033807401 -> 9033807401)
    if (queryDigits.startsWith('0')) {
      const strippedZero = queryDigits.replace(/^0+/, '');
      if (strippedZero.length > 0 && phoneDigits.includes(strippedZero)) {
        return true;
      }
    }

    // Handle leading 91 (India) in query or phone
    const phoneNo91 = phoneDigits.startsWith('91') && phoneDigits.length >= 12 ? phoneDigits.slice(2) : phoneDigits;
    const queryNo91 = queryDigits.startsWith('91') && queryDigits.length >= 12 ? queryDigits.slice(2) : queryDigits;

    if (phoneDigits.includes(queryNo91)) return true;
    if (phoneNo91.includes(queryDigits)) return true;
    if (phoneNo91.includes(queryNo91)) return true;
  }

  return false;
}
