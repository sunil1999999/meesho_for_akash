/**
 * Account Eligibility & Order History Filtering for Direct Checkout & Pay
 * 
 * Excludes any account that has at least one successfully placed or confirmed Meesho order.
 * Ensures only zero-order accounts are displayed for checkout.
 */

export interface CheckoutAccountItem {
  id: number | string; // Stable Shop ID or unique account ID
  mobile: string;
  supabase_id?: string; // Stable Supabase UUID
  user_id?: number | string;
  status?: string; // e.g. 'sold', 'active'
  record_status?: string; // Authoritative Supabase record_status ('sold', 'active')
  total_orders_discovered?: number;
  monitoring_status?: string; // Authoritative Supabase monitoring_status ('sold_excluded')
  order_placed?: any;
  tags?: string[];
  account_json?: Record<string, any>;
}

export interface VerifiedOrderRecord {
  id: string;
  account_id: string; // Stable account ID
  external_order_id?: string | null;
  delivery_status?: string;
  payment_status?: string;
  cancellation_status?: string;
}

export interface FilterAccountsResult {
  eligibleAccounts: CheckoutAccountItem[];
  excludedAccountIds: Set<string>;
  error?: string | null;
}

/**
 * Determines whether an account has 'Sold' status in the authoritative database or backend.
 * Checks status, record_status, monitoring_status ('sold_excluded' / 'terminal_sold'), and tags.
 */
export function isSoldAccount(account: CheckoutAccountItem): boolean {
  if (!account) return false;

  const status = String(account.status || '').toLowerCase().trim();
  const recordStatus = String(account.record_status || '').toLowerCase().trim();
  const monitoringStatus = String(account.monitoring_status || '').toLowerCase().trim();

  // Primary check: status or record_status marked as 'sold'
  if (status === 'sold' || recordStatus === 'sold') {
    return true;
  }

  // Authoritative monitoring status set when marked sold in database
  if (monitoringStatus === 'sold_excluded' || monitoringStatus === 'terminal_sold') {
    return true;
  }

  // Tags check if account was tagged with 'sold'
  if (Array.isArray(account.tags) && account.tags.some(t => String(t).toLowerCase().trim() === 'sold')) {
    return true;
  }

  return false;
}

/**
 * Determines whether an order record represents a genuine placed, confirmed, or cancelled order.
 * Failed payment attempts or pending sessions without an order are NOT counted as placed orders.
 */
export function isConfirmedOrPlacedOrder(order: VerifiedOrderRecord): boolean {
  if (!order) return false;

  const deliveryStatus = String(order.delivery_status || '').toLowerCase().trim();
  const paymentStatus = String(order.payment_status || '').toLowerCase().trim();
  const cancellationStatus = String(order.cancellation_status || '').toLowerCase().trim();

  // If the record represents a failed attempt with no order fulfillment, it is NOT a placed order
  if (paymentStatus === 'failed' || deliveryStatus === 'failed') {
    return false;
  }

  // Pending payment session with no confirmed order is NOT a confirmed order
  if (paymentStatus === 'pending' && (!deliveryStatus || deliveryStatus === 'pending')) {
    return false;
  }

  // Cancelled order on Meesho was an order that was placed and subsequently cancelled (Account g -> hidden)
  if (deliveryStatus === 'cancelled' || cancellationStatus === 'cancelled') {
    return true;
  }

  // Successfully placed, confirmed, shipped, or delivered orders
  const confirmedDeliveryStatuses = [
    'placed',
    'confirmed',
    'shipped',
    'out_for_delivery',
    'delivered',
    'returned',
    'rto',
  ];

  if (confirmedDeliveryStatuses.includes(deliveryStatus)) {
    return true;
  }

  // Payment completed (paid or cod) unless explicitly marked failed
  if (paymentStatus === 'paid' || paymentStatus === 'cod') {
    return true;
  }

  return false;
}

/**
 * Filters the account list to exclude any accounts that have already placed at least one confirmed order.
 * 
 * Rules:
 * - Uses stable unique IDs (shop ID and Supabase UUID) to match order history.
 * - If order history cannot be verified (error or null), does not silently assume 0 orders; returns an error.
 * - Handles failed payments and pending unconfirmed orders by leaving them visible.
 * - Hides accounts with confirmed, placed, or cancelled orders.
 */
export function filterAccountsWithoutConfirmedOrders(
  accounts: CheckoutAccountItem[],
  orders: VerifiedOrderRecord[] | null | undefined,
  options?: {
    isError?: boolean;
    errorMessage?: string;
  }
): FilterAccountsResult {
  // Account F: Order history cannot be verified -> do not silently classify as having no orders
  if (options?.isError || orders === null || orders === undefined) {
    return {
      eligibleAccounts: [],
      excludedAccountIds: new Set<string>(),
      error: options?.errorMessage || 'Order history could not be verified. Please retry.',
    };
  }

  const excludedAccountIds = new Set<string>();

  // 1. Scan verified order records
  for (const order of orders) {
    if (isConfirmedOrPlacedOrder(order)) {
      if (order.account_id) {
        excludedAccountIds.add(String(order.account_id).trim());
      }
    }
  }

  // 2. Filter accounts
  const eligibleAccounts = accounts.filter(account => {
    const shopIdStr = String(account.id).trim();
    const supabaseIdStr = account.supabase_id ? String(account.supabase_id).trim() : null;

    // Rule 1 (Account H): If account status is Sold, exclude it regardless of order history
    if (isSoldAccount(account)) {
      excludedAccountIds.add(shopIdStr);
      if (supabaseIdStr) excludedAccountIds.add(supabaseIdStr);
      return false;
    }

    // Rule 2: If account has at least one confirmed, placed, or cancelled order, exclude it
    // Check if stable shop ID is in excluded orders
    if (excludedAccountIds.has(shopIdStr)) {
      return false;
    }

    // Check if stable Supabase UUID is in excluded orders
    if (supabaseIdStr && excludedAccountIds.has(supabaseIdStr)) {
      return false;
    }

    // Check if proxy backend explicitly flagged order_placed
    if (account.order_placed != null) {
      excludedAccountIds.add(shopIdStr);
      if (supabaseIdStr) excludedAccountIds.add(supabaseIdStr);
      return false;
    }

    // Check if Supabase account record already tracks discovered orders
    if (
      (account.total_orders_discovered !== undefined && account.total_orders_discovered > 0) ||
      account.monitoring_status === 'has_orders'
    ) {
      excludedAccountIds.add(shopIdStr);
      if (supabaseIdStr) excludedAccountIds.add(supabaseIdStr);
      return false;
    }

    return true;
  });

  return {
    eligibleAccounts,
    excludedAccountIds,
    error: null,
  };
}
