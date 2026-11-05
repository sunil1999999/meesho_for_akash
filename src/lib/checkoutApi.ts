/**
 * Dedicated API Client for Meesho Direct Checkout & Payments
 */

import {
  ProductDetail,
  ProductSearchResultItem,
  ProductSearchResponse,
  IsolatedCartResponse,
  DeliveryAddress,
  CheckoutQuote,
  UpiPaymentSession,
  PaymentStatusResult,
  OrderConfirmationResult,
  AutoAddCartResult,
  FreeCheckoutResult,
} from '../types';

const API_BASE = '/api/checkout';

// Shared singleton promise to prevent concurrent refreshes
let activeRefreshPromise: Promise<boolean> | null = null;

export async function refreshAuthSession(accountId?: number): Promise<boolean> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      const resp = await fetch(`${API_BASE}/refresh-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.success !== false && (data.data?.ok || data.ok)) {
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

async function request<T>(path: string, options: RequestInit = {}, retryCount = 0): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Server returned non-JSON response (${response.status}): ${text.slice(0, 100)}`);
  }

  const rawError = typeof json.error === 'string' ? json.error : (typeof json.message === 'string' ? json.message : '');
  const lowerError = rawError.toLowerCase();
  const is401OrExpired =
    response.status === 401 ||
    json.status_code === 401 ||
    rawError.includes('401') ||
    lowerError.includes('session expired');

  const isBlocked =
    lowerError.includes('account has been blocked') ||
    lowerError.includes('account is blocked') ||
    (lowerError.includes('blocked') && !lowerError.includes('session expired/blocked') && !lowerError.includes('session expired'));

  // Prevent automatic retries on non-idempotent operations like placing orders or payments
  const isNonIdempotent = path === '/place-cod' || path === '/pay' || path === '/confirm';

  // Automatically refresh on recoverable HTTP 401 / session expired
  if (is401OrExpired && !isBlocked && retryCount === 0 && !isNonIdempotent && path !== '/refresh-session') {
    const refreshed = await refreshAuthSession();
    if (refreshed) {
      // Retry original request once
      return request<T>(path, options, retryCount + 1);
    }
  }

  if (!response.ok || json.success === false) {
    let errorMsg = rawError || `Request failed with HTTP ${response.status}`;
    if (isBlocked) {
      errorMsg = 'Your account has been blocked or restricted. Please contact support or reconnect.';
    } else if (is401OrExpired) {
      errorMsg = 'Your session has expired. Please log in again to continue.';
    } else if (response.status === 410 || json.status_code === 410 || errorMsg.includes('Address not found')) {
      errorMsg = 'Your selected delivery address is unavailable or has expired. Please select another verified address.';
    } else if (response.status === 500 && (!rawError || rawError === 'HTTP 500' || rawError === '""' || rawError.includes('{"error":""}'))) {
      errorMsg = 'Quote could not be refreshed from upstream server. Please retry in a moment.';
    }
    throw new Error(errorMsg);
  }

  return (json.data !== undefined ? json.data : json) as T;
}

export const CheckoutApi = {
  /**
   * Refreshes the authorized checkout session.
   */
  async refreshSession(accountId?: number): Promise<{ ok: boolean }> {
    const ok = await refreshAuthSession(accountId);
    return { ok };
  },

  /**
   * Resolves a public Meesho product URL into catalog details, sizes, images, stock.
   */
  async resolveProduct(link: string): Promise<ProductDetail> {
    const res = await request<ProductDetail>('/resolve', {
      method: 'POST',
      body: JSON.stringify({ link }),
    });
    return res;
  },

  /**
   * Searches products by name, keyword, product code, or URL.
   */
  async searchProducts(query: string, offset = 0): Promise<ProductSearchResponse> {
    const res = await request<ProductSearchResponse>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, offset }),
    });
    return res;
  },

  /**
   * Strictly isolates the checkout cart to ensure ONLY the selected product is present.
   * Purges any unrelated items left over in the remote cart.
   */
  async isolateCart(payload: {
    productId: number;
    supplierId: number;
    variationId: number;
    variationName: string;
    quantity: number;
  }): Promise<IsolatedCartResponse> {
    const res = await request<IsolatedCartResponse>('/cart/isolate', {
      method: 'POST',
      body: JSON.stringify({
        product_id: payload.productId,
        supplier_id: payload.supplierId,
        variation_id: payload.variationId,
        variation: payload.variationName,
        quantity: payload.quantity,
      }),
    });
    return res;
  },

  /**
   * Fetches active cart items from the remote Meesho session.
   */
  async getCart(): Promise<{ items: any[]; total?: number; total_quantity?: number; cart_session?: string }> {
    return request('/cart', {
      method: 'GET',
    });
  },

  /**
   * Fetches active accounts available in the shop session.
   */
  async getAccounts(): Promise<Array<{ id: number; mobile: string }>> {
    const res = await request<{ accounts: Array<{ id: number; mobile: string }> }>('/accounts', {
      method: 'GET',
    });
    return res.accounts || [];
  },

  /**
   * Switches the active checkout session to a specific account.
   */
  async selectAccount(accountId: number): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>('/select-account', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId }),
    });
  },

  /**
   * Fetches saved delivery addresses for the active authenticated account.
   */
  /**
   * Fetches saved delivery addresses for the active authenticated account.
   */
  async getAddresses(): Promise<DeliveryAddress[]> {
    const res = await request<{ addresses: DeliveryAddress[]; default?: DeliveryAddress | null }>('/addresses', {
      method: 'GET',
    });
    return (res.addresses || []).map(a => ({
      ...a,
      is_upstream_registered: true,
    }));
  },

  /**
   * Registers a new delivery address with Meesho via the backend.
   */
  async createAddress(address: Partial<DeliveryAddress>): Promise<{ ok: boolean; address?: DeliveryAddress }> {
    const res = await request<{ ok: boolean; address?: { address?: DeliveryAddress } | DeliveryAddress }>('/addresses/create', {
      method: 'POST',
      body: JSON.stringify(address),
    });
    const addrObj = (res.address as any)?.address || res.address;
    return {
      ok: res.ok,
      address: addrObj ? { ...addrObj, is_upstream_registered: true } : undefined,
    };
  },

  /**
   * Bulk address broadcasting across accounts is disabled.
   * Requirement: Addresses are never automatically applied to all accounts.
   */
  async bulkAddAddress(_address: Partial<DeliveryAddress>): Promise<{
    processed: number;
    added: number;
    already_present: number;
    failed: number;
    total_eligible: number;
  }> {
    console.warn('bulkAddAddress called but automatic address broadcasting is disabled per policy.');
    return {
      processed: 0,
      added: 0,
      already_present: 0,
      failed: 0,
      total_eligible: 0,
    };
  },

  /**
   * Refreshes active and expiring authentication sessions across accounts.
   */
  async bulkRefreshSessions(): Promise<{
    refreshed: number;
    failed: number;
    total_checked: number;
  }> {
    return request('/sessions/bulk-refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  /**
   * Adds the selected product variant & quantity to the remote cart.
   */
  async addToCart(
    productId: number,
    supplierId: number,
    variationId: number,
    variationName: string,
    quantity: number = 1
  ): Promise<{ success: boolean; effective_total?: number; total_quantity?: number }> {
    return request('/cart/add', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        supplier_id: supplierId,
        variation_id: variationId,
        variation: variationName,
        quantity,
      }),
    });
  },

  /**
   * Auto-adds ONLY the explicitly selected product, variant, and quantity to cart
   * exclusively for accounts that have NOT placed their first order.
   *
   * Strict Rules:
   * 1. Check order history first using reliable order-history data.
   * 2. If no successful order exists, add selected product, variant & quantity.
   * 3. If an order has already been placed, skip account.
   * 4. NEVER auto-checkout, place orders, or initiate payment.
   * 5. Stop immediately after adding to cart.
   * 6. Handle uncertain order history safely: skip if verification fails, never assume 0 orders.
   * 7. Prevent duplicate cart additions: check existing cart first.
   * 8. Preserve account eligibility rules: exclude Sold and ineligible accounts.
   * 9. Return clear results with counts for added, skipped_has_orders, skipped_unverified, failed.
   */
  async autoAddProductToCart(payload: {
    productId: number;
    supplierId: number;
    variationId: number;
    variationName: string;
    quantity: number;
  }): Promise<AutoAddCartResult> {
    return request<AutoAddCartResult>('/cart/auto-add', {
      method: 'POST',
      body: JSON.stringify({
        product_id: payload.productId,
        supplier_id: payload.supplierId,
        variation_id: payload.variationId,
        variation: payload.variationName,
        quantity: payload.quantity,
      }),
    });
  },

  /**
   * Binds the destination address/pincode to the remote cart.
   */
  async setCartLocation(addressId: number, destPin: string, cartSession?: string): Promise<any> {
    if (!addressId) {
      throw new Error('Valid delivery address ID is required to set location');
    }
    return request('/cart/location', {
      method: 'POST',
      body: JSON.stringify({
        address_id: addressId,
        dest_pin: destPin,
        cart_session: cartSession,
      }),
    });
  },

  /**
   * Obtains an authoritative server quote with FOD and COD vs Online breakdown.
   */
  async getQuote(addressId?: number | null, productId?: number | null): Promise<CheckoutQuote> {
    return request<CheckoutQuote>('/quote', {
      method: 'POST',
      body: JSON.stringify({
        address_id: addressId !== undefined ? addressId : null,
        product_id: productId !== undefined ? productId : null,
      }),
    });
  },

  /**
   * Places a Cash on Delivery (COD) order.
   */
  async placeCod(addressId: number): Promise<{ ok: boolean; order_num: string; total: number; message?: string }> {
    if (!addressId) {
      throw new Error('Please select a verified delivery address first');
    }
    return request('/place-cod', {
      method: 'POST',
      body: JSON.stringify({ address_id: addressId }),
    });
  },

  /**
   * Initiates an Online UPI Payment session through Meesho / Juspay.
   * Locks the checkout reference to prevent changing order/payment IDs mid-flight.
   */
  async payOnline(addressId: number, checkoutReference?: string, orderNum?: string): Promise<UpiPaymentSession> {
    if (!addressId) {
      throw new Error('Please select a verified delivery address first');
    }
    return request<UpiPaymentSession>('/pay', {
      method: 'POST',
      body: JSON.stringify({
        address_id: addressId,
        checkout_reference: checkoutReference,
        order_num: orderNum,
      }),
    });
  },

  /**
   * Polls payment status from the payment gateway.
   */
  async checkPaymentStatus(
    orderNum: string,
    cartSession: string,
    juspayOrderId: string,
    checkoutReference?: string
  ): Promise<PaymentStatusResult> {
    return request<PaymentStatusResult>('/status', {
      method: 'POST',
      body: JSON.stringify({
        order_num: orderNum,
        cart_session: cartSession,
        juspay_order_id: juspayOrderId,
        checkout_reference: checkoutReference,
      }),
    });
  },

  /**
   * Commits and confirms an order with Meesho once payment is charged.
   */
  async confirmOrder(orderNum: string, cartSession: string, checkoutReference?: string): Promise<OrderConfirmationResult> {
    return request<OrderConfirmationResult>('/confirm', {
      method: 'POST',
      body: JSON.stringify({
        order_num: orderNum,
        cart_session: cartSession,
        checkout_reference: checkoutReference,
      }),
    });
  },

  /**
   * Executes authorized Free Payment Mode checkout via the bridge.
   * Strictly avoids real payment initiation or Juspay charging.
   */
  async executeFreeCheckout(payload: {
    checkoutReference: string;
    accountId: number | string;
    addressId: number;
    productId: number;
    variationId: number;
    quantity: number;
  }): Promise<FreeCheckoutResult> {
    return request<FreeCheckoutResult>('/free-checkout', {
      method: 'POST',
      body: JSON.stringify({
        checkout_reference: payload.checkoutReference,
        account_id: payload.accountId,
        address_id: payload.addressId,
        product_id: payload.productId,
        variation_id: payload.variationId,
        quantity: payload.quantity,
      }),
    });
  },
};
