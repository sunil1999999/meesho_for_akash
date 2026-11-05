/**
 * Predefined & Local Delivery Address Management
 * 
 * Persists saved address entries per stable account ID, validates Indian postal codes
 * and required fields, and distinguishes between locally entered addresses and
 * verified upstream Meesho registered addresses.
 */

import { DeliveryAddress } from '../types';

const STORAGE_KEY_PREFIX = 'meesho_saved_addresses_';

export interface AddressValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates required address fields and Indian postal code.
 */
export function validateAddressForCheckout(address: Partial<DeliveryAddress>): AddressValidationResult {
  if (!address) {
    return { valid: false, error: 'Address details are required' };
  }

  const name = String(address.name || '').trim();
  if (!name || name.length < 2) {
    return { valid: false, error: 'Please enter a valid recipient name (min 2 characters)' };
  }

  let rawMobile = String(address.mobile || '').replace(/\D/g, '');
  if (rawMobile.length === 12 && rawMobile.startsWith('91')) {
    rawMobile = rawMobile.slice(2);
  }
  if (!/^[6-9]\d{9}$/.test(rawMobile)) {
    return { valid: false, error: 'Please enter a valid 10-digit Indian mobile number' };
  }

  const pin = String(address.pin || '').trim();
  if (!/^\d{6}$/.test(pin)) {
    return { valid: false, error: 'Please enter a valid 6-digit Indian PIN code' };
  }

  const line1 = String(address.address_line_1 || '').trim();
  if (!line1 || line1.length < 3) {
    return { valid: false, error: 'Address line 1 is required (House/Building/Street)' };
  }

  const city = String(address.city || '').trim();
  if (!city) {
    return { valid: false, error: 'City is required' };
  }

  const state = String(address.state || '').trim();
  if (!state) {
    return { valid: false, error: 'State is required' };
  }

  return { valid: true };
}

const memoryStore = new Map<string, string>();

function getStorageItem(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {}
  return memoryStore.get(key) ?? null;
}

function setStorageItem(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
      return;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {}
  memoryStore.set(key, value);
}

/**
 * Retrieves locally saved predefined addresses for a specific stable account ID.
 */
export function getSavedAddresses(accountId: string | number): DeliveryAddress[] {
  if (!accountId) return [];
  const key = `${STORAGE_KEY_PREFIX}${accountId}`;
  try {
    const raw = getStorageItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn(`Failed to read saved addresses for account ${accountId}:`, err);
    return [];
  }
}

/**
 * Saves or updates a predefined delivery address for an account.
 */
export function saveDeliveryAddress(
  accountId: string | number,
  address: Partial<DeliveryAddress>
): DeliveryAddress {
  if (!accountId) {
    throw new Error('Account ID is required to save delivery address');
  }

  const validation = validateAddressForCheckout(address);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const existing = getSavedAddresses(accountId);
  const localId = address.local_id || `local_addr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let cleanMobile = String(address.mobile || '').replace(/\D/g, '');
  if (cleanMobile.length === 12 && cleanMobile.startsWith('91')) {
    cleanMobile = cleanMobile.slice(2);
  }

  const record: DeliveryAddress = {
    id: address.id || 0, // 0 indicates not yet registered with Meesho upstream
    local_id: localId,
    account_id: accountId,
    name: String(address.name || '').trim(),
    mobile: cleanMobile,
    address_line_1: String(address.address_line_1 || '').trim(),
    address_line_2: String(address.address_line_2 || '').trim(),
    landmark: String(address.landmark || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim(),
    pin: String(address.pin || '').trim(),
    address_type: address.address_type || 'Home',
    is_upstream_registered: Boolean(address.id && address.id > 0 && address.is_upstream_registered !== false),
    is_default: Boolean(address.is_default),
    created_at: address.created_at || new Date().toISOString(),
  };

  const filtered = existing.filter(a => a.local_id !== localId && (record.id === 0 || a.id !== record.id));
  const updated = [record, ...filtered];

  try {
    setStorageItem(`${STORAGE_KEY_PREFIX}${accountId}`, JSON.stringify(updated));
  } catch (err) {
    console.warn(`Failed to save address to storage for account ${accountId}:`, err);
  }

  return record;
}

/**
 * Deletes a saved address for an account.
 */
export function deleteSavedAddress(
  accountId: string | number,
  localIdOrId: string | number
): void {
  if (!accountId) return;
  const existing = getSavedAddresses(accountId);
  const updated = existing.filter(a => a.local_id !== String(localIdOrId) && a.id !== Number(localIdOrId));
  try {
    setStorageItem(`${STORAGE_KEY_PREFIX}${accountId}`, JSON.stringify(updated));
  } catch (err) {
    console.warn(`Failed to delete address for account ${accountId}:`, err);
  }
}

/**
 * Clears all locally saved addresses for an account (useful for reset or testing).
 */
export function clearSavedAddresses(accountId?: string | number): void {
  if (accountId) {
    setStorageItem(`${STORAGE_KEY_PREFIX}${accountId}`, JSON.stringify([]));
  } else {
    memoryStore.clear();
  }
}

/**
 * Merges upstream Meesho registered addresses with locally saved addresses for an account.
 * Upstream addresses take priority for Meesho checkout readiness.
 */
export function mergeAccountAddresses(
  accountId: string | number,
  upstreamAddresses: DeliveryAddress[]
): DeliveryAddress[] {
  const localAddresses = getSavedAddresses(accountId);
  const resultMap = new Map<string, DeliveryAddress>();

  // 1. Add upstream addresses (guaranteed to be registered on Meesho)
  for (const up of upstreamAddresses) {
    const key = `up_${up.id}`;
    resultMap.set(key, {
      ...up,
      is_upstream_registered: true,
      account_id: accountId,
    });
  }

  // 2. Add local addresses (match by id or phone+pin+address_line_1 to prevent duplicates)
  for (const loc of localAddresses) {
    const matchingUpstream = upstreamAddresses.find(
      up => up.id === loc.id || (
        up.pin === loc.pin &&
        up.mobile === loc.mobile &&
        up.address_line_1.toLowerCase() === loc.address_line_1.toLowerCase()
      )
    );

    if (matchingUpstream) {
      // Sync local address with confirmed upstream id
      const key = `up_${matchingUpstream.id}`;
      resultMap.set(key, {
        ...loc,
        ...matchingUpstream,
        local_id: loc.local_id,
        is_upstream_registered: true,
        account_id: accountId,
      });
    } else {
      // Local address not yet registered on upstream Meesho
      const key = `loc_${loc.local_id || loc.id}`;
      if (!resultMap.has(key)) {
        resultMap.set(key, {
          ...loc,
          is_upstream_registered: Boolean(loc.id && loc.id > 0),
          account_id: accountId,
        });
      }
    }
  }

  return Array.from(resultMap.values());
}

export const STORAGE_KEY_PRESET_ADDRESSES = 'meesho_saved_preset_addresses';

export const DEFAULT_PRESET_ADDRESSES: DeliveryAddress[] = [
  {
    id: 0,
    local_id: 'preset_addr_surat_01',
    name: 'Rahul Verma',
    mobile: '9876543210',
    address_line_1: 'Flat 402, Sunshine Residency, Ring Road',
    address_line_2: 'Near City Centre Mall',
    city: 'Surat',
    state: 'Gujarat',
    pin: '395007',
    address_type: 'Home',
    is_upstream_registered: false,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 0,
    local_id: 'preset_addr_ahmedabad_02',
    name: 'Priya Patel',
    mobile: '9823456789',
    address_line_1: '12, Gokuldham Society, Satellite Road',
    address_line_2: 'Opposite Star Bazaar',
    city: 'Ahmedabad',
    state: 'Gujarat',
    pin: '380015',
    address_type: 'Home',
    is_upstream_registered: false,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 0,
    local_id: 'preset_addr_bangalore_03',
    name: 'Ananya Iyer',
    mobile: '9912345678',
    address_line_1: 'Plot 88, 5th Cross, 100ft Road, Indiranagar',
    address_line_2: 'Behind Metro Station',
    city: 'Bangalore',
    state: 'Karnataka',
    pin: '560038',
    address_type: 'Work',
    is_upstream_registered: false,
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

/**
 * Retrieves the global preset delivery addresses available for assignment.
 */
export function getPresetAddresses(): DeliveryAddress[] {
  try {
    const raw = getStorageItem(STORAGE_KEY_PRESET_ADDRESSES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to read preset addresses:', err);
  }
  // Initialize with default presets if none saved yet
  try {
    setStorageItem(STORAGE_KEY_PRESET_ADDRESSES, JSON.stringify(DEFAULT_PRESET_ADDRESSES));
  } catch {}
  return [...DEFAULT_PRESET_ADDRESSES];
}

/**
 * Saves or updates a preset delivery address in the system library.
 */
export function savePresetAddress(address: Partial<DeliveryAddress>): DeliveryAddress {
  const validation = validateAddressForCheckout(address);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const existing = getPresetAddresses();
  const localId = address.local_id || `preset_addr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  let cleanMobile = String(address.mobile || '').replace(/\D/g, '');
  if (cleanMobile.length === 12 && cleanMobile.startsWith('91')) {
    cleanMobile = cleanMobile.slice(2);
  }

  const record: DeliveryAddress = {
    id: address.id || 0,
    local_id: localId,
    name: String(address.name || '').trim(),
    mobile: cleanMobile,
    address_line_1: String(address.address_line_1 || '').trim(),
    address_line_2: String(address.address_line_2 || '').trim(),
    landmark: String(address.landmark || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim(),
    pin: String(address.pin || '').trim(),
    address_type: address.address_type || 'Home',
    is_upstream_registered: false,
    created_at: address.created_at || new Date().toISOString(),
  };

  const filtered = existing.filter(a => a.local_id !== localId);
  const updated = [record, ...filtered];

  try {
    setStorageItem(STORAGE_KEY_PRESET_ADDRESSES, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to save preset address:', err);
  }

  return record;
}

/**
 * Deletes a preset delivery address by localId or id.
 */
export function deletePresetAddress(localIdOrId: string | number): void {
  const existing = getPresetAddresses();
  const updated = existing.filter(a => a.local_id !== String(localIdOrId) && a.id !== Number(localIdOrId));
  try {
    setStorageItem(STORAGE_KEY_PRESET_ADDRESSES, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to delete preset address:', err);
  }
}

/**
 * Collects all distinct known saved addresses across presets and accounts.
 * Used to display options during account import or manual address assignment.
 */
export function getAllKnownAddresses(): DeliveryAddress[] {
  const presets = getPresetAddresses();
  const resultMap = new Map<string, DeliveryAddress>();

  const getDedupeKey = (a: DeliveryAddress) =>
    `${(a.name || '').trim().toLowerCase()}_${(a.pin || '').trim()}_${(a.address_line_1 || '').trim().toLowerCase()}`;

  for (const addr of presets) {
    const key = getDedupeKey(addr);
    resultMap.set(key, addr);
  }

  // Also collect any addresses stored per account in localStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(STORAGE_KEY_PREFIX)) {
          const raw = window.localStorage.getItem(k);
          if (raw) {
            try {
              const list = JSON.parse(raw);
              if (Array.isArray(list)) {
                for (const item of list) {
                  const key = getDedupeKey(item);
                  if (!resultMap.has(key)) {
                    resultMap.set(key, item);
                  }
                }
              }
            } catch {}
          }
        }
      }
    }
  } catch {}

  // Check memoryStore keys as well
  for (const [k, raw] of memoryStore.entries()) {
    if (k.startsWith(STORAGE_KEY_PREFIX)) {
      try {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            const key = getDedupeKey(item);
            if (!resultMap.has(key)) {
              resultMap.set(key, item);
            }
          }
        }
      } catch {}
    }
  }

  return Array.from(resultMap.values());
}

/**
 * Retrieves the assigned delivery address for a specific account.
 * Checks account_json.assigned_address, account_json.delivery_address, or per-account local storage.
 * Returns null if no address is assigned.
 */
export function getAccountAssignedAddress(
  account: { id?: string; account_json?: Record<string, any> } | string | null | undefined
): DeliveryAddress | null {
  if (!account) return null;

  if (typeof account === 'string') {
    const list = getSavedAddresses(account);
    return list.length > 0 ? list[0] : null;
  }

  if (account.account_json?.assigned_address) {
    return account.account_json.assigned_address as DeliveryAddress;
  }

  if (account.account_json?.delivery_address) {
    return account.account_json.delivery_address as DeliveryAddress;
  }

  if (account.id) {
    const list = getSavedAddresses(account.id);
    return list.length > 0 ? list[0] : null;
  }

  return null;
}

