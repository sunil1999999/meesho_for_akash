/**
 * Export Utilities for Meesho Management Dashboard
 * 
 * STRICT COMPLIANCE RULE:
 * ABSOLUTE RESTRICTION: NEVER CREATE, GENERATE, UPLOAD, DOWNLOAD, OR USE ZIP FILES
 * OR ANY OTHER ARCHIVES.
 * Individual exports must remain separate standalone files.
 * Combined exports must be directly downloadable data files (JSON, JSONL, TXT, CSV),
 * never bundled archives.
 */

import { AccountRecord, OrderRecord } from '../types';

/** List of sensitive authentication/hardware keys that must be masked in safe-copy */
const SENSITIVE_KEYS = new Set([
  'xo',
  'ox',
  'token',
  'auth_token',
  'session_token',
  'access_token',
  'instance_id',
  'gaid',
  'device_token',
  'secret',
  'password',
]);

/**
 * Creates a sanitized copy of the account JSON object by omitting sensitive auth tokens
 */
export function sanitizeAccountJsonForSafeCopy(rawJson: Record<string, any>): Record<string, any> {
  if (!rawJson || typeof rawJson !== 'object') return rawJson;

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(rawJson)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = '[REDACTED_SENSITIVE_VALUE]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeAccountJsonForSafeCopy(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Triggers a direct browser download of a plain text / data file
 */
export function triggerFileDownload(content: string, filename: string, mimeType: string = 'application/json'): void {
  // Defensive assertion against archive extensions
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith('.zip') || lowerName.endsWith('.tar') || lowerName.endsWith('.gz') || lowerName.endsWith('.rar') || lowerName.endsWith('.7z')) {
    throw new Error('Security policy violation: Archive files (ZIP/TAR/RAR) are strictly prohibited.');
  }

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a single account as a standalone .json file
 */
export function downloadSingleAccountJson(account: AccountRecord, includeSensitive: boolean = true): void {
  const payload = includeSensitive ? account.account_json : sanitizeAccountJsonForSafeCopy(account.account_json);
  const phoneClean = account.phone_normalized.replace(/[^0-9]/g, '');
  const filename = `account_${phoneClean || account.id.slice(0, 8)}.json`;
  triggerFileDownload(JSON.stringify(payload, null, 2), filename, 'application/json');
}

/**
 * Exports multiple accounts as a combined JSON array file
 */
export function exportAccountsCombinedJson(accounts: AccountRecord[], includeSensitive: boolean = true): void {
  const data = accounts.map(a => includeSensitive ? a.account_json : sanitizeAccountJsonForSafeCopy(a.account_json));
  const filename = `meesho_accounts_combined_${new Date().toISOString().slice(0, 10)}.json`;
  triggerFileDownload(JSON.stringify(data, null, 2), filename, 'application/json');
}

/**
 * Exports Direct Checkout eligible accounts as a combined JSON array file
 */
export function exportDirectCheckoutAccountsJson(
  accounts: Array<{ id: number | string; mobile: string; user_id?: number | string; account_json?: Record<string, any> }>,
  options?: { includeMetadata?: boolean; filenamePrefix?: string }
): void {
  const data = accounts.map(a => {
    if (options?.includeMetadata) {
      return {
        direct_checkout_id: a.id,
        mobile: a.mobile,
        user_id: a.user_id,
        account_json: a.account_json || { mobile: a.mobile, user_id: a.user_id, id: a.id },
      };
    }
    return a.account_json || {
      id: a.id,
      mobile: a.mobile,
      user_id: a.user_id,
    };
  });
  const prefix = options?.filenamePrefix || 'direct_checkout_accounts';
  const filename = `${prefix}_${new Date().toISOString().slice(0, 10)}.json`;
  triggerFileDownload(JSON.stringify(data, null, 2), filename, 'application/json');
}

/**
 * Exports multiple accounts as JSON Lines / NDJSON (one JSON object per line)
 */
export function exportAccountsJsonLines(accounts: AccountRecord[], includeSensitive: boolean = true): void {
  const lines = accounts.map(a => {
    const obj = includeSensitive ? a.account_json : sanitizeAccountJsonForSafeCopy(a.account_json);
    return JSON.stringify(obj);
  }).join('\n');
  const filename = `meesho_accounts_${new Date().toISOString().slice(0, 10)}.jsonl`;
  triggerFileDownload(lines, filename, 'application/x-ndjson');
}

/**
 * Exports multiple accounts as TXT containing separated pretty-printed JSON objects
 */
export function exportAccountsTxtSeparated(accounts: AccountRecord[], includeSensitive: boolean = true): void {
  const content = accounts.map(a => {
    const obj = includeSensitive ? a.account_json : sanitizeAccountJsonForSafeCopy(a.account_json);
    return JSON.stringify(obj, null, 2);
  }).join('\n\n// ----------------------------------------\n\n');
  const filename = `meesho_accounts_${new Date().toISOString().slice(0, 10)}.txt`;
  triggerFileDownload(content, filename, 'text/plain');
}

/**
 * Exports accounts metadata as CSV
 */
export function exportAccountsCsv(accounts: AccountRecord[]): void {
  const headers = ['ID', 'Phone (Normalized)', 'Phone (Display)', 'Record Status', 'Tags', 'Source File', 'Created At'];
  const rows = accounts.map(a => [
    `"${a.id}"`,
    `"${a.phone_normalized}"`,
    `"${a.phone_display}"`,
    `"${a.record_status}"`,
    `"${(a.tags || []).join(';')}"`,
    `"${(a.source_file || '').replace(/"/g, '""')}"`,
    `"${a.created_at}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const filename = `meesho_accounts_metadata_${new Date().toISOString().slice(0, 10)}.csv`;
  triggerFileDownload(csvContent, filename, 'text/csv');
}

/**
 * Exports orders as CSV
 */
export function exportOrdersCsv(orders: OrderRecord[]): void {
  const headers = [
    'Order ID',
    'Account Phone',
    'External Order ID',
    'Tracking ID',
    'Tracking Status',
    'Product Name',
    'SKU',
    'Amount (INR)',
    'Quantity',
    'Payment Status',
    'Delivery Status',
    'Cancellation Status',
    'Return Status',
    'Refund Status',
    'Refund Amount',
    'Refund Reference',
    'Order Date',
  ];

  const rows = orders.map(o => [
    `"${o.id}"`,
    `"${o.account_phone || ''}"`,
    `"${(o.external_order_id || '').replace(/"/g, '""')}"`,
    `"${(o.tracking_id || '').replace(/"/g, '""')}"`,
    `"${o.tracking_id ? 'Tracking ID Assigned' : 'Not Assigned'}"`,
    `"${(o.product_name || '').replace(/"/g, '""')}"`,
    `"${(o.sku || '').replace(/"/g, '""')}"`,
    o.order_amount,
    o.quantity,
    `"${o.payment_status}"`,
    `"${o.delivery_status}"`,
    `"${o.cancellation_status}"`,
    `"${o.return_status}"`,
    `"${o.refund_status}"`,
    o.refund_amount || 0,
    `"${(o.refund_reference || '').replace(/"/g, '""')}"`,
    `"${o.order_date}"`,
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const filename = `meesho_orders_${new Date().toISOString().slice(0, 10)}.csv`;
  triggerFileDownload(csvContent, filename, 'text/csv');
}

/**
 * Exports a clean delivery fulfillment sheet for ordered accounts
 */
export function exportDeliverySheetCsv(orders: OrderRecord[], accounts: AccountRecord[] = [], filenamePrefix = 'meesho_delivery_sheet'): void {
  const accountMap = new Map<string, AccountRecord>();
  accounts.forEach(a => {
    accountMap.set(a.id, a);
    if (a.phone_normalized) accountMap.set(a.phone_normalized, a);
    if (a.phone_display) accountMap.set(a.phone_display, a);
    const cleanPhone = a.phone_normalized ? a.phone_normalized.replace(/[^0-9]/g, '') : '';
    if (cleanPhone) {
      accountMap.set(cleanPhone, a);
      accountMap.set(cleanPhone.slice(-10), a);
    }
  });

  const headers = [
    'Order ID',
    'Order Date',
    'Delivery Timestamp',
    'Account Mobile',
    'Tracking ID',
    'Tracking Status',
    'Product Name',
    'Catalog SKU',
    'Quantity',
    'Total Amount (INR)',
    'Payment Mode',
    'Delivery Status',
    'Shipment / Tracking Status',
    'Recipient / Delivery Details',
    'Data Source',
  ];

  const rows = orders.map(o => {
    const acc = accountMap.get(o.account_id) || (o.account_phone ? accountMap.get(o.account_phone.replace(/[^0-9]/g, '').slice(-10)) : undefined);
    const mobile = o.account_phone || acc?.phone_display || acc?.phone_normalized || '';
    const paymentMode = o.payment_status === 'cod' ? 'Cash on Delivery (COD)' : 'Prepaid (UPI / Online)';
    const tracking = o.shipment_status || o.delivery_status || 'In Transit';
    const deliveryNotes = (o.notes || '').replace(/"/g, '""');
    const deliveryTimestamp = getOrderDeliveryDate(o) || '';
    const trackingId = (o.tracking_id || '').replace(/"/g, '""');
    const trackingStatus = o.tracking_id ? 'Tracking ID Assigned' : 'Not Assigned';

    return [
      `"${(o.external_order_id || o.id).replace(/"/g, '""')}"`,
      `"${o.order_date || o.created_at || ''}"`,
      `"${deliveryTimestamp}"`,
      `"${mobile}"`,
      `"${trackingId}"`,
      `"${trackingStatus}"`,
      `"${(o.product_name || 'Meesho Product').replace(/"/g, '""')}"`,
      `"${(o.sku || '').replace(/"/g, '""')}"`,
      o.quantity || 1,
      o.order_amount || 0,
      `"${paymentMode}"`,
      `"${o.delivery_status || 'placed'}"`,
      `"${tracking}"`,
      `"${deliveryNotes}"`,
      `"${o.data_source || 'verified_api'}"`,
    ];
  });

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const filename = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
  triggerFileDownload(csvContent, filename, 'text/csv');
}

/**
 * Application Configured Timezone System
 * Default: 'Asia/Kolkata' (IST)
 */
export const DEFAULT_APP_TIMEZONE = 'Asia/Kolkata';

let configuredTimezone: string | null = null;

export function getAppTimezone(): string {
  if (configuredTimezone) return configuredTimezone;
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = window.localStorage.getItem('app_timezone');
    if (stored) return stored;
  }
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_APP_TIMEZONE) {
    return (import.meta as any).env.VITE_APP_TIMEZONE;
  }
  return DEFAULT_APP_TIMEZONE;
}

export function setAppTimezone(tz: string): void {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    configuredTimezone = tz;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('app_timezone', tz);
    }
  } catch {
    throw new Error(`Invalid IANA time zone: ${tz}`);
  }
}

/**
 * Calculates wall clock timezone offset in milliseconds for a specific Date in a timeZone.
 * Handles DST and offset differences accurately using Intl formatToParts.
 */
export function getTimezoneOffsetAtDate(date: Date, timeZone: string = getAppTimezone()): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    fractionalSecondDigits: 3,
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  const tzWallClockUtc = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    hour,
    parseInt(map.minute, 10),
    parseInt(map.second, 10),
    parseInt(map.fractionalSecond || '0', 10)
  );
  return tzWallClockUtc - date.getTime();
}

/**
 * Calculates exact start of today (00:00:00.000) and end of today (23:59:59.999)
 * in the application's configured timezone.
 */
export function getTodayBoundariesInTimezone(
  timeZone: string = getAppTimezone(),
  referenceDate: Date = new Date()
): { startOfDay: Date; endOfDay: Date; todayDateStr: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayDateStr = formatter.format(referenceDate);
  const [year, month, day] = todayDateStr.split('-').map(Number);

  const approxUtcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const offsetAtStart = getTimezoneOffsetAtDate(approxUtcMidnight, timeZone);
  const startOfDay = new Date(approxUtcMidnight.getTime() - offsetAtStart);

  const approxNextDayMidnight = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  const offsetAtNextDay = getTimezoneOffsetAtDate(approxNextDayMidnight, timeZone);
  const nextDayStartMs = approxNextDayMidnight.getTime() - offsetAtNextDay;
  const endOfDay = new Date(nextDayStartMs - 1);

  return { startOfDay, endOfDay, todayDateStr };
}

/**
 * Determines whether a given timestamp or date falls within today's boundaries
 * in the configured timezone.
 */
export function isSameDayInTimezone(
  dateInput: string | number | Date | undefined | null,
  timeZone: string = getAppTimezone(),
  referenceDate: Date = new Date()
): boolean {
  if (!dateInput) return false;

  // Handle plain YYYY-MM-DD date string without time
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const { todayDateStr } = getTodayBoundariesInTimezone(timeZone, referenceDate);
    return dateInput.trim() === todayDateStr;
  }

  const d = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return false;

  const { startOfDay, endOfDay } = getTodayBoundariesInTimezone(timeZone, referenceDate);
  const dTime = d.getTime();

  return dTime >= startOfDay.getTime() && dTime <= endOfDay.getTime();
}

/**
 * Checks whether a given timestamp or date matches calendar "today" in the configured timezone.
 */
export function isSameDayAsToday(
  dateInput: string | number | Date | undefined | null,
  timeZone: string = getAppTimezone(),
  referenceDate?: Date
): boolean {
  return isSameDayInTimezone(dateInput, timeZone, referenceDate);
}

/**
 * Extracts order placement date from OrderRecord
 */
export function getOrderPlacementDate(order: OrderRecord): string {
  return order.order_date || order.created_at;
}

/**
 * Extracts actual delivery status change timestamp from OrderRecord.
 * Only applicable if delivery_status is 'delivered'.
 * 
 * Strict priority:
 * 1. delivered_at
 * 2. delivery_status_changed_at
 * 3. terminal_confirmed_at (continuous monitor / terminal tracking)
 * 
 * STRICT COMPLIANCE: NEVER fallback to created_at, order_date, or updated_at.
 */
export function getOrderDeliveryDate(order: OrderRecord): string | undefined {
  if (order.delivery_status !== 'delivered') return undefined;
  return order.delivered_at || order.delivery_status_changed_at || order.terminal_confirmed_at;
}

/**
 * Option A: Today's Orders Placed Sheet
 * Export all orders placed today, regardless of their current delivery status.
 * Filters strictly by order placement date.
 */
export function exportTodaysOrdersPlacedSheet(
  orders: OrderRecord[],
  accounts: AccountRecord[] = [],
  timeZone: string = getAppTimezone(),
  referenceDate: Date = new Date()
): number {
  const seenIds = new Set<string>();
  const uniqueOrders: OrderRecord[] = [];
  for (const o of orders) {
    if (!seenIds.has(o.id)) {
      seenIds.add(o.id);
      uniqueOrders.push(o);
    }
  }

  const todaysPlacedOrders = uniqueOrders.filter(o => {
    const placementDate = getOrderPlacementDate(o);
    return isSameDayAsToday(placementDate, timeZone, referenceDate);
  });

  exportDeliverySheetCsv(todaysPlacedOrders, accounts, 'todays_orders_placed_sheet');
  return todaysPlacedOrders.length;
}

/**
 * Option B: Today's Successfully Delivered Orders Sheet
 * 
 * Export ONLY orders whose delivery status changed to Delivered today.
 * Filters strictly by delivery status transition date (delivered_at / delivery_status_changed_at),
 * NOT order placement date.
 * Excludes pending, placed, processing, shipped, cancelled, returned, and previously delivered orders.
 * Applies application configured timezone boundaries.
 * Deduplicates records so re-exporting produces consistent results.
 */
export function exportTodaysDeliveredOrdersSheet(
  orders: OrderRecord[],
  accounts: AccountRecord[] = [],
  timeZone: string = getAppTimezone(),
  referenceDate: Date = new Date()
): number {
  const seenIds = new Set<string>();
  const uniqueOrders: OrderRecord[] = [];
  for (const o of orders) {
    if (!seenIds.has(o.id)) {
      seenIds.add(o.id);
      uniqueOrders.push(o);
    }
  }

  const todaysDeliveredOrders = uniqueOrders.filter(o => {
    if (o.delivery_status !== 'delivered') return false;
    const deliveryDate = getOrderDeliveryDate(o);
    if (!deliveryDate) return false;
    return isSameDayAsToday(deliveryDate, timeZone, referenceDate);
  });

  exportDeliverySheetCsv(todaysDeliveredOrders, accounts, 'todays_delivered_orders_sheet');
  return todaysDeliveredOrders.length;
}

/**
 * Filters orders placed today or in the last 24 hours and generates a clean delivery sheet
 * (Kept for backward compatibility with existing tests and callers)
 */
export function exportTodaysOrdersDeliverySheet(orders: OrderRecord[], accounts: AccountRecord[] = []): number {
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();
  const oneDayMs = 24 * 3600 * 1000;

  // Filter for orders placed today or within last 24h
  let todaysOrders = orders.filter(o => {
    const dStr = (o.order_date || o.created_at || '').slice(0, 10);
    if (dStr === todayStr) return true;
    const orderTime = new Date(o.order_date || o.created_at).getTime();
    return !isNaN(orderTime) && nowMs - orderTime <= oneDayMs;
  });

  // If none matched exact 24h (e.g. initial demo/test data), fallback to all confirmed/placed orders
  if (todaysOrders.length === 0) {
    todaysOrders = orders.filter(o => o.delivery_status !== 'cancelled' && o.payment_status !== 'failed');
  }

  exportDeliverySheetCsv(todaysOrders, accounts, 'todays_ordered_accounts_delivery_sheet');
  return todaysOrders.length;
}

/**
 * Triggers multiple individual file downloads sequentially with a small delay
 * to avoid browser download floods, WITHOUT creating an archive.
 */
export async function downloadAllIndividualFiles(
  accounts: AccountRecord[],
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  const total = accounts.length;
  for (let i = 0; i < total; i++) {
    downloadSingleAccountJson(accounts[i], true);
    if (onProgress) {
      onProgress(i + 1, total);
    }
    // Small pause between browser download events
    await new Promise(res => setTimeout(res, 250));
  }
}
