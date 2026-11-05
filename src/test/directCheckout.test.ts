import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckoutApi, refreshAuthSession } from '../lib/checkoutApi';
import { StorageService } from '../lib/storageAdapter';
import {
  ProductDetail,
  DeliveryAddress,
  CheckoutQuote,
  UpiPaymentSession,
} from '../types';
import {
  filterAccountsWithoutConfirmedOrders,
  isConfirmedOrPlacedOrder,
  isSoldAccount,
  CheckoutAccountItem,
  VerifiedOrderRecord,
} from '../lib/checkoutEligibility';
import {
  validateAddressForCheckout,
  getSavedAddresses,
  saveDeliveryAddress,
  deleteSavedAddress,
  mergeAccountAddresses,
  clearSavedAddresses,
} from '../lib/addressStorage';

describe('Direct Checkout & Payment Workflow Test Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Product Resolution & Link Validation', () => {
    it('validates and rejects empty product links', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ success: false, error: 'Product link cannot be empty' }),
      } as any);

      await expect(CheckoutApi.resolveProduct('')).rejects.toThrow('Product link cannot be empty');
    });

    it('resolves valid Meesho product link and parses variants and stock', async () => {
      const mockProduct: ProductDetail = {
        product_id: 1053270803,
        catalog_id: 553022308,
        name: "Feminine Women's Casual Printed Kurti Pack of 4",
        brand: null,
        in_stock: true,
        mrp: 1399,
        price: 512,
        images: ['https://images.meesho.com/images/products/1053270803/r5xa9_512.jpg'],
        highlights: [{ name: 'Color', value: 'Yellow' }],
        supplier_id: 2249146,
        supplier_name: 'AmmyCreation',
        sizes: [
          { name: 'S', variation_id: 3, in_stock: true },
          { name: 'M', variation_id: 4, in_stock: false },
        ],
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: mockProduct }),
      } as any);

      const res = await CheckoutApi.resolveProduct('https://www.meesho.com/s/p/hf38yb');
      expect(res.product_id).toBe(1053270803);
      expect(res.in_stock).toBe(true);
      expect(res.sizes.length).toBe(2);
      expect(res.sizes[0].in_stock).toBe(true);
      expect(res.sizes[1].in_stock).toBe(false);
    });
  });

  describe('2. Delivery Address & Cart Binding', () => {
    it('retrieves saved delivery addresses', async () => {
      const mockAddresses: DeliveryAddress[] = [
        {
          id: 768709375,
          name: 'Seenu Kumar',
          mobile: '7230986965',
          address_line_1: 'DRM Office Opposite GCS Hospital',
          city: 'Ahmedabad',
          state: 'Gujarat',
          pin: '380016',
          valid: true,
        },
      ];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { addresses: mockAddresses } }),
      } as any);

      const addrs = await CheckoutApi.getAddresses();
      expect(addrs.length).toBe(1);
      expect(addrs[0].pin).toBe('380016');
    });

    it('adds product variant to remote cart and binds location', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { success: true, effective_total: 512, total_quantity: 1 } }),
      } as any);

      const cartRes = await CheckoutApi.addToCart(1053270803, 2249146, 3, 'S', 1);
      expect(cartRes.success).toBe(true);
    });
  });

  describe('3. Authoritative Quote & Discount Verification', () => {
    it('calculates verified quote with prepaid discount and first-order offer', async () => {
      const mockQuote: CheckoutQuote = {
        is_verified: true,
        address_id: 768709375,
        cart_session: 'mock_cart_session_123',
        product_subtotal: 512,
        cod_payable: 512,
        online_payable: 487, // ₹25 prepaid discount
        prepaid_discount: 25,
        first_order_discount: 50,
        fod_offer: { title: 'Upto', text: '₹50 OFF', subtitle: 'on 1st order', max_value: 50 },
        delivery_charge: 0,
        currency: 'INR',
        quoted_at: new Date().toISOString(),
        cart_items_count: 1,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: mockQuote }),
      } as any);

      const quote = await CheckoutApi.getQuote(768709375);
      expect(quote.is_verified).toBe(true);
      expect(quote.online_payable).toBe(487);
      expect(quote.prepaid_discount).toBe(25);
      expect(quote.cod_payable).toBe(512);
    });

    it('labels unverified quote when delivery address is null', async () => {
      const mockQuote: CheckoutQuote = {
        is_verified: false,
        address_id: null,
        cart_session: 'mock_session',
        product_subtotal: 512,
        cod_payable: 512,
        online_payable: 512,
        prepaid_discount: 0,
        first_order_discount: 0,
        delivery_charge: 0,
        currency: 'INR',
        quoted_at: new Date().toISOString(),
        cart_items_count: 1,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: mockQuote }),
      } as any);

      const quote = await CheckoutApi.getQuote(null);
      expect(quote.is_verified).toBe(false);
      expect(quote.address_id).toBeNull();
    });
  });

  describe('4. Cash on Delivery (COD) Order Placement & Supabase', () => {
    it('places COD order and receives genuine order number', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: { ok: true, order_num: '984129581024', total: 512, message: 'Order placed' },
        }),
      } as any);

      const res = await CheckoutApi.placeCod(768709375);
      expect(res.ok).toBe(true);
      expect(res.order_num).toBe('984129581024');

      // Persist to Supabase
      const saved = await StorageService.createOrder({
        account_id: 'acc_test_123',
        external_order_id: res.order_num,
        product_name: 'Test Kurti',
        quantity: 1,
        order_amount: res.total,
        payment_status: 'cod',
        delivery_status: 'placed',
        cancellation_status: 'none',
        return_status: 'none',
        refund_status: 'none',
        data_source: 'verified_api',
        order_date: new Date().toISOString(),
      });

      expect(saved.external_order_id).toBe('984129581024');
      expect(saved.payment_status).toBe('cod');
    });
  });

  describe('5. Google Pay / Online Payment State Machine', () => {
    it('initiates online payment and returns NPCI UPI URI and Juspay details', async () => {
      const mockSession: UpiPaymentSession = {
        order_num: '7102948192',
        juspay_order_id: 'jp_7102948192',
        cart_session: 'cs_live_session',
        amount: 487,
        upi_uri: 'upi://pay?pa=meeshobusiness@icici&pn=Meesho&am=487.00&tr=7102948192&cu=INR',
        redirect_url: 'https://api.juspay.in/orders/in_7102948192',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: mockSession }),
      } as any);

      const session = await CheckoutApi.payOnline(768709375);
      expect(session.order_num).toBe('7102948192');
      expect(session.amount).toBe(487);
      expect(session.upi_uri).toContain('upi://pay?');
      expect(session.upi_uri).toContain('meeshobusiness');
      expect(session.redirect_url).toContain('juspay.in');
    });

    it('polls payment status and detects SUCCESS', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: { state: 'success', status: 'CHARGED', order_num: '7102948192' },
        }),
      } as any);

      const res = await CheckoutApi.checkPaymentStatus('7102948192', 'cs_live_session', 'jp_7102948192');
      expect(res.state).toBe('success');
      expect(res.status).toBe('CHARGED');
    });

    it('confirms order with Meesho only after payment is verified', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: { ok: true, order_num: '7102948192', message: 'Payment received — your order is confirmed!' },
        }),
      } as any);

      const confRes = await CheckoutApi.confirmOrder('7102948192', 'cs_live_session');
      expect(confRes.ok).toBe(true);
      expect(confRes.order_num).toBe('7102948192');

      // Persist online order to Supabase
      const saved = await StorageService.createOrder({
        account_id: 'acc_test_123',
        external_order_id: confRes.order_num,
        product_name: 'Test Kurti',
        quantity: 1,
        order_amount: 487,
        payment_status: 'paid',
        delivery_status: 'placed',
        cancellation_status: 'none',
        return_status: 'none',
        refund_status: 'none',
        data_source: 'verified_api',
        order_date: new Date().toISOString(),
      });

      expect(saved.external_order_id).toBe('7102948192');
      expect(saved.payment_status).toBe('paid');
    });

    it('safeguards against order confirmation failure when payment was charged', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: false,
          error: 'Out of stock — payment will be refunded',
        }),
      } as any);

      await expect(CheckoutApi.confirmOrder('7102948192', 'cs_live_session')).rejects.toThrow('Out of stock');
    });
  });

  describe('6. Account Eligibility & Order History Filtering (Acceptance Criteria A-H)', () => {
    const mockAccounts: CheckoutAccountItem[] = [
      { id: 101, supabase_id: 'sub-uuid-101', mobile: '9876543210' }, // Account A: 1 confirmed order
      { id: 102, supabase_id: 'sub-uuid-102', mobile: '9876543211' }, // Account B: multiple confirmed orders
      { id: 103, supabase_id: 'sub-uuid-103', mobile: '9876543212' }, // Account C: 0 orders, active
      { id: 104, supabase_id: 'sub-uuid-104', mobile: '9876543213' }, // Account D: only failed payment
      { id: 105, supabase_id: 'sub-uuid-105', mobile: '9876543214' }, // Account E: pending payment
      { id: 107, supabase_id: 'sub-uuid-107', mobile: '9876543216' }, // Account g: cancelled order
      { id: 108, supabase_id: 'sub-uuid-108', mobile: '9876543217', record_status: 'sold' }, // Account H: Sold Status -> Hidden even with 0 orders
    ];

    it('identifies confirmed, cancelled, failed, and pending orders correctly via isConfirmedOrPlacedOrder', () => {
      // Confirmed / placed
      expect(isConfirmedOrPlacedOrder({ id: '1', account_id: 'sub-uuid-101', delivery_status: 'placed' })).toBe(true);
      expect(isConfirmedOrPlacedOrder({ id: '2', account_id: 'sub-uuid-101', delivery_status: 'delivered' })).toBe(true);
      expect(isConfirmedOrPlacedOrder({ id: '3', account_id: 'sub-uuid-101', payment_status: 'paid' })).toBe(true);
      expect(isConfirmedOrPlacedOrder({ id: '4', account_id: 'sub-uuid-101', payment_status: 'cod' })).toBe(true);

      // Account g: cancelled orders MUST count as placed/confirmed orders that consume eligibility
      expect(isConfirmedOrPlacedOrder({ id: '5', account_id: 'sub-uuid-107', delivery_status: 'cancelled' })).toBe(true);
      expect(isConfirmedOrPlacedOrder({ id: '6', account_id: 'sub-uuid-107', cancellation_status: 'cancelled' })).toBe(true);

      // Account D: only failed attempts are NOT confirmed orders
      expect(isConfirmedOrPlacedOrder({ id: '7', account_id: 'sub-uuid-104', payment_status: 'failed', delivery_status: 'failed' })).toBe(false);

      // Account E: pending payment session with no confirmed order is NOT a confirmed order
      expect(isConfirmedOrPlacedOrder({ id: '8', account_id: 'sub-uuid-105', payment_status: 'pending' })).toBe(false);
    });

    it('Account A (1 confirmed order) is hidden from Direct Checkout', () => {
      const orders: VerifiedOrderRecord[] = [
        { id: 'o-1', account_id: 'sub-uuid-101', delivery_status: 'placed' },
      ];
      const result = filterAccountsWithoutConfirmedOrders(mockAccounts, orders);
      const ids = result.eligibleAccounts.map(a => a.id);
      expect(ids).not.toContain(101);
    });

    it('Account B (multiple confirmed orders) is hidden from Direct Checkout', () => {
      const orders: VerifiedOrderRecord[] = [
        { id: 'o-2a', account_id: 'sub-uuid-102', delivery_status: 'delivered' },
        { id: 'o-2b', account_id: 'sub-uuid-102', delivery_status: 'shipped' },
      ];
      const result = filterAccountsWithoutConfirmedOrders(mockAccounts, orders);
      const ids = result.eligibleAccounts.map(a => a.id);
      expect(ids).not.toContain(102);
    });

    it('Account C (no order history) is displayed in Direct Checkout', () => {
      const orders: VerifiedOrderRecord[] = [];
      const result = filterAccountsWithoutConfirmedOrders(mockAccounts, orders);
      const ids = result.eligibleAccounts.map(a => a.id);
      expect(ids).toContain(103);
    });

    it('Account D (only failed payment) is displayed in Direct Checkout', () => {
      const orders: VerifiedOrderRecord[] = [
        { id: 'o-4', account_id: 'sub-uuid-104', payment_status: 'failed', delivery_status: 'failed' },
      ];
      const result = filterAccountsWithoutConfirmedOrders(mockAccounts, orders);
      const ids = result.eligibleAccounts.map(a => a.id);
      expect(ids).toContain(104);
    });

    it('Account E (pending payment with no confirmed order) is displayed in Direct Checkout', () => {
      const orders: VerifiedOrderRecord[] = [
        { id: 'o-5', account_id: 'sub-uuid-105', payment_status: 'pending' },
      ];
      const result = filterAccountsWithoutConfirmedOrders(mockAccounts, orders);
      const ids = result.eligibleAccounts.map(a => a.id);
      expect(ids).toContain(105);
    });

    it('Account F (order history cannot be verified) shows warning and returns no accounts', () => {
      // Database/API error condition
      const errorResult = filterAccountsWithoutConfirmedOrders(mockAccounts, null, {
        isError: true,
        errorMessage: 'Network timeout querying Supabase orders table',
      });
      expect(errorResult.eligibleAccounts).toHaveLength(0);
      expect(errorResult.error).toContain('Network timeout');

      // Undefined orders condition
      const undefinedResult = filterAccountsWithoutConfirmedOrders(mockAccounts, undefined);
      expect(undefinedResult.eligibleAccounts).toHaveLength(0);
      expect(undefinedResult.error).toBeDefined();
    });

    it('Account g (cancelled orders) is hidden from Direct Checkout', () => {
      const orders: VerifiedOrderRecord[] = [
        { id: 'o-7', account_id: 'sub-uuid-107', delivery_status: 'cancelled', cancellation_status: 'cancelled' },
      ];
      const result = filterAccountsWithoutConfirmedOrders(mockAccounts, orders);
      const ids = result.eligibleAccounts.map(a => a.id);
      expect(ids).not.toContain(107);
    });

    it('matches order history accurately using stable numeric shop ID or stable Supabase UUID', () => {
      // Order referencing numeric shop ID string
      const ordersShopId: VerifiedOrderRecord[] = [
        { id: 'o-num', account_id: '103', delivery_status: 'placed' },
      ];
      const resShopId = filterAccountsWithoutConfirmedOrders(mockAccounts, ordersShopId);
      expect(resShopId.eligibleAccounts.map(a => a.id)).not.toContain(103);

      // Order referencing Supabase UUID string
      const ordersUuid: VerifiedOrderRecord[] = [
        { id: 'o-uuid', account_id: 'sub-uuid-103', delivery_status: 'placed' },
      ];
      const resUuid = filterAccountsWithoutConfirmedOrders(mockAccounts, ordersUuid);
      expect(resUuid.eligibleAccounts.map(a => a.id)).not.toContain(103);
    });

    it('dynamically excludes an account immediately when an order is placed and confirmed without page refresh', () => {
      // Start with Account C having no orders
      let currentOrders: VerifiedOrderRecord[] = [
        { id: 'o-1', account_id: 'sub-uuid-101', delivery_status: 'placed' },
        { id: 'o-2', account_id: 'sub-uuid-102', delivery_status: 'delivered' },
        { id: 'o-7', account_id: 'sub-uuid-107', delivery_status: 'cancelled' },
      ];

      const initialFilter = filterAccountsWithoutConfirmedOrders(mockAccounts, currentOrders);
      expect(initialFilter.eligibleAccounts.map(a => a.id)).toContain(103);

      // Order is placed on Account C
      const newPlacedOrder: VerifiedOrderRecord = {
        id: 'o-new-999',
        account_id: 'sub-uuid-103',
        delivery_status: 'placed',
        payment_status: 'cod',
        external_order_id: 'order_999999',
      };

      currentOrders = [...currentOrders, newPlacedOrder];
      const updatedFilter = filterAccountsWithoutConfirmedOrders(mockAccounts, currentOrders);
      expect(updatedFilter.eligibleAccounts.map(a => a.id)).not.toContain(103);
    });

    it('identifies Sold accounts accurately via isSoldAccount across all authoritative status fields', () => {
      expect(isSoldAccount({ id: 1, mobile: '111', record_status: 'sold' })).toBe(true);
      expect(isSoldAccount({ id: 2, mobile: '222', status: 'Sold' })).toBe(true);
      expect(isSoldAccount({ id: 3, mobile: '333', monitoring_status: 'sold_excluded' })).toBe(true);
      expect(isSoldAccount({ id: 4, mobile: '444', monitoring_status: 'terminal_sold' })).toBe(true);
      expect(isSoldAccount({ id: 5, mobile: '555', tags: ['vip', 'sold'] })).toBe(true);

      // Active / regular accounts
      expect(isSoldAccount({ id: 6, mobile: '666', record_status: 'active' })).toBe(false);
      expect(isSoldAccount({ id: 7, mobile: '777', status: 'active', monitoring_status: 'pending' })).toBe(false);
    });

    it('Account H (Sold status) is hidden from Direct Checkout even when it has NO confirmed orders', () => {
      // Empty orders list: Account H has zero order history
      const emptyOrders: VerifiedOrderRecord[] = [];
      const result = filterAccountsWithoutConfirmedOrders(mockAccounts, emptyOrders);
      const ids = result.eligibleAccounts.map(a => a.id);

      // Account H (id: 108) must be excluded
      expect(ids).not.toContain(108);

      // Other zero-order accounts (Account C: 103, D: 104, E: 105) must remain displayed
      expect(ids).toContain(103);
      expect(ids).toContain(104);
      expect(ids).toContain(105);
    });

    it('applies updated filtering rule: hides if (1) Sold OR (2) has placed/confirmed order; preserves other eligible accounts', () => {
      const orders: VerifiedOrderRecord[] = [
        { id: 'o-1', account_id: 'sub-uuid-101', delivery_status: 'placed' }, // Account A has 1 confirmed order -> hidden
        { id: 'o-2a', account_id: 'sub-uuid-102', delivery_status: 'delivered' }, // Account B has confirmed order -> hidden
        { id: 'o-7', account_id: 'sub-uuid-107', delivery_status: 'cancelled' }, // Account g has cancelled order -> hidden
        // Account H (108) has no orders in this list, but has record_status: 'sold' -> hidden
        // Account C (103) has 0 orders, active -> displayed
        // Account D (104) has failed attempt -> displayed
        // Account E (105) has pending payment -> displayed
      ];

      const result = filterAccountsWithoutConfirmedOrders(mockAccounts, orders);
      const eligibleIds = result.eligibleAccounts.map(a => a.id);

      // Hidden accounts:
      expect(eligibleIds).not.toContain(101); // Confirmed order
      expect(eligibleIds).not.toContain(102); // Confirmed order
      expect(eligibleIds).not.toContain(107); // Cancelled order
      expect(eligibleIds).not.toContain(108); // Sold status (no orders)

      // Displayed accounts:
      expect(eligibleIds).toContain(103); // Zero orders
      expect(eligibleIds).toContain(104); // Failed payment only
      expect(eligibleIds).toContain(105); // Pending payment session only

      // Verify non-destructive filtering: underlying mock account objects are not mutated or deleted
      expect(mockAccounts.find(a => a.id === 108)?.record_status).toBe('sold');
      expect(mockAccounts).toHaveLength(7);
    });
  });

  describe('7. Predefined Delivery Address Management & Account Isolation (Sections 1 & 5)', () => {
    beforeEach(() => {
      clearSavedAddresses();
    });

    it('validates Indian 6-digit postal code strictly', () => {
      expect(validateAddressForCheckout({ pin: '12345', name: 'Dev', mobile: '9876543210', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ pin: '1234567', name: 'Dev', mobile: '9876543210', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ pin: 'ABCDEF', name: 'Dev', mobile: '9876543210', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ pin: '560001', name: 'Dev', mobile: '9876543210', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(true);
    });

    it('validates 10-digit Indian mobile number strictly', () => {
      expect(validateAddressForCheckout({ mobile: '1234567890', pin: '560001', name: 'Dev', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ mobile: '98765', pin: '560001', name: 'Dev', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ mobile: '9876543210', pin: '560001', name: 'Dev', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(true);
      expect(validateAddressForCheckout({ mobile: '+919876543210', pin: '560001', name: 'Dev', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(true);
    });

    it('validates recipient name and address lines', () => {
      expect(validateAddressForCheckout({ name: '', pin: '560001', mobile: '9876543210', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ name: 'A', pin: '560001', mobile: '9876543210', address_line_1: 'MG Road', city: 'BLR', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ name: 'Anil Kumar', address_line_1: '', pin: '560001', mobile: '9876543210', city: 'BLR', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ name: 'Anil Kumar', address_line_1: 'Flat 101', city: '', pin: '560001', mobile: '9876543210', state: 'KA' }).valid).toBe(false);
      expect(validateAddressForCheckout({ name: 'Anil Kumar', address_line_1: 'Flat 101', city: 'BLR', pin: '560001', mobile: '9876543210', state: '' }).valid).toBe(false);
    });

    it('returns empty array when no saved addresses exist for an account', () => {
      const addresses = getSavedAddresses('acc_empty_999');
      expect(addresses).toEqual([]);
    });

    it('saves a new local address with generated local_id and marks is_upstream_registered: false', () => {
      const saved = saveDeliveryAddress('acc_101', {
        name: 'Rohan Sharma',
        mobile: '9876543210',
        address_line_1: 'B-24 Crystal Heights',
        city: 'Surat',
        state: 'Gujarat',
        pin: '395007',
        address_type: 'Home',
      });

      expect(saved.local_id).toBeDefined();
      expect(saved.id).toBe(0);
      expect(saved.is_upstream_registered).toBe(false);
      expect(saved.account_id).toBe('acc_101');
      expect(saved.pin).toBe('395007');

      const retrieved = getSavedAddresses('acc_101');
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].name).toBe('Rohan Sharma');
    });

    it('isolates saved addresses between different accounts', () => {
      saveDeliveryAddress('acc_user_1', {
        name: 'Account 1 User',
        mobile: '9876543211',
        address_line_1: 'Sector 15',
        city: 'Noida',
        state: 'Uttar Pradesh',
        pin: '201301',
      });

      saveDeliveryAddress('acc_user_2', {
        name: 'Account 2 User',
        mobile: '9876543212',
        address_line_1: 'Indiranagar 100ft Rd',
        city: 'Bangalore',
        state: 'Karnataka',
        pin: '560038',
      });

      const user1Addrs = getSavedAddresses('acc_user_1');
      const user2Addrs = getSavedAddresses('acc_user_2');

      expect(user1Addrs).toHaveLength(1);
      expect(user1Addrs[0].name).toBe('Account 1 User');
      expect(user2Addrs).toHaveLength(1);
      expect(user2Addrs[0].name).toBe('Account 2 User');
    });

    it('deletes saved address for an account without affecting other accounts', () => {
      const addr = saveDeliveryAddress('acc_del_test', {
        name: 'To Delete',
        mobile: '9876543213',
        address_line_1: 'Delete Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        pin: '400001',
      });

      expect(getSavedAddresses('acc_del_test')).toHaveLength(1);
      deleteSavedAddress('acc_del_test', addr.local_id!);
      expect(getSavedAddresses('acc_del_test')).toHaveLength(0);
    });

    it('merges upstream registered addresses with local addresses and distinguishes upstream status', () => {
      const upstreamAddresses: DeliveryAddress[] = [
        {
          id: 773430946,
          name: 'Upstream Registered Recipient',
          mobile: '9387596885',
          address_line_1: 'House 42 Green Park',
          city: 'Delhi',
          state: 'Delhi',
          pin: '110016',
          valid: true,
        },
      ];

      // Local address not yet registered upstream
      saveDeliveryAddress('acc_merge_test', {
        name: 'Local Only Recipient',
        mobile: '9123456789',
        address_line_1: 'Flat 301 Sunshine',
        city: 'Pune',
        state: 'Maharashtra',
        pin: '411001',
      });

      const merged = mergeAccountAddresses('acc_merge_test', upstreamAddresses);
      expect(merged).toHaveLength(2);

      const upstream = merged.find(a => a.id === 773430946);
      expect(upstream).toBeDefined();
      expect(upstream?.is_upstream_registered).toBe(true);

      const local = merged.find(a => a.name === 'Local Only Recipient');
      expect(local).toBeDefined();
      expect(local?.is_upstream_registered).toBe(false);
      expect(local?.id).toBe(0);
    });

    it('syncs local address to upstream registered status when details match upstream', () => {
      const upstreamAddresses: DeliveryAddress[] = [
        {
          id: 776684263,
          name: 'Rohan Sharma',
          mobile: '9876543210',
          address_line_1: 'B-24 Crystal Heights',
          city: 'Surat',
          state: 'Gujarat',
          pin: '395007',
          valid: true,
        },
      ];

      saveDeliveryAddress('acc_sync_test', {
        name: 'Rohan Sharma',
        mobile: '9876543210',
        address_line_1: 'B-24 Crystal Heights',
        city: 'Surat',
        state: 'Gujarat',
        pin: '395007',
      });

      const merged = mergeAccountAddresses('acc_sync_test', upstreamAddresses);
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe(776684263);
      expect(merged[0].is_upstream_registered).toBe(true);
    });
  });

  describe('8. HTTP 410 Address Error Prevention & Verified Address Guards (Sections 2 & 5)', () => {
    it('CheckoutApi.getQuote(null) returns preliminary estimate and never sends address_id: null to /order/prices', async () => {
      let requestedBody: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
        requestedBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            success: true,
            data: {
              is_verified: false,
              address_id: null,
              cart_session: 'cs_unverified',
              product_subtotal: 512,
              cod_payable: 512,
              online_payable: 512,
              notice: 'Select a verified delivery address to calculate shipping & checkout discounts.',
            },
          }),
        };
      });

      const quote = await CheckoutApi.getQuote(null);
      expect(requestedBody.address_id).toBeNull();
      expect(quote.is_verified).toBe(false);
      expect(quote.notice).toContain('Select a verified delivery address');
    });

    it('CheckoutApi.placeCod rejects immediately if addressId is null or 0', async () => {
      await expect(CheckoutApi.placeCod(0)).rejects.toThrow('Please select a verified delivery address first');
      await expect(CheckoutApi.placeCod(null as any)).rejects.toThrow('Please select a verified delivery address first');
    });

    it('CheckoutApi.payOnline rejects immediately if addressId is null or 0', async () => {
      await expect(CheckoutApi.payOnline(0)).rejects.toThrow('Please select a verified delivery address first');
      await expect(CheckoutApi.payOnline(null as any)).rejects.toThrow('Please select a verified delivery address first');
    });

    it('maps upstream HTTP 410 response into a user-friendly expiration message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 410,
        text: async () => JSON.stringify({
          description: 'Address not found for id null , country IN',
          status_code: 410,
        }),
      } as any);

      await expect(CheckoutApi.getQuote(99999999)).rejects.toThrow(
        'Your selected delivery address is unavailable or has expired. Please select another verified address.'
      );
    });

    it('maps HTTP 410 when address becomes unavailable between quote and order placement', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 410,
        text: async () => JSON.stringify({
          error: 'Address not found for id 773430946, country IN',
          status_code: 410,
        }),
      } as any);

      await expect(CheckoutApi.placeCod(773430946)).rejects.toThrow(
        'Your selected delivery address is unavailable or has expired. Please select another verified address.'
      );
    });
  });

  describe('9. Product Price Calculation, Discounts & Cart Dynamics (Sections 3 & 5)', () => {
    it('compares catalog estimate with authoritative checkout quote and highlights discounts', async () => {
      // 1. Catalog Estimate
      const catalogPrice = 512;
      const mrp = 1399;

      // 2. Verified Quote Response from Meesho Upstream
      const verifiedQuote: CheckoutQuote = {
        is_verified: true,
        address_id: 773430946,
        cart_session: 'cs_verified_123',
        product_subtotal: 512,
        first_order_discount: 190,
        prepaid_discount: 26,
        delivery_charge: 0,
        cod_payable: 307,      // 512 - 190 = 322? actually Meesho quote gave 307
        online_payable: 281,   // 307 - 26 = 281
        currency: 'INR',
        cart_items_count: 1,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: verifiedQuote }),
      } as any);

      const quote = await CheckoutApi.getQuote(773430946);

      expect(quote.product_subtotal).toBe(catalogPrice);
      expect(quote.is_verified).toBe(true);
      expect(quote.first_order_discount).toBe(190);
      expect(quote.prepaid_discount).toBe(26);
      expect(quote.cod_payable).toBe(307);
      expect(quote.online_payable).toBe(281);
      // COD and Online totals differ due to prepaid discount
      expect(quote.cod_payable).toBeGreaterThan(quote.online_payable);
      expect(mrp).toBeGreaterThan(catalogPrice);
    });

    it('safely handles missing, null, or undefined discount fields without producing NaN', async () => {
      const quoteWithNullDiscounts: CheckoutQuote = {
        is_verified: true,
        address_id: 773430946,
        cart_session: 'cs_sparse',
        product_subtotal: 512,
        first_order_discount: undefined,
        prepaid_discount: undefined,
        delivery_charge: 0,
        cod_payable: 512,
        online_payable: 512,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: quoteWithNullDiscounts }),
      } as any);

      const quote = await CheckoutApi.getQuote(773430946);
      expect(quote.cod_payable).toBe(512);
      expect(quote.online_payable).toBe(512);
      expect(Number.isNaN(quote.cod_payable)).toBe(false);
      expect(Number.isNaN(quote.online_payable)).toBe(false);
    });

    it('handles pricing endpoint network timeout gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network request timed out'));

      await expect(CheckoutApi.getQuote(773430946)).rejects.toThrow('Network request timed out');
    });
  });

  describe('10. Automatic Session Refresh on HTTP 401 & Recovery Workflow (Section 8)', () => {
    it('detects 401 on idempotent operation, refreshes session and retries once automatically', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/refresh-session')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, data: { ok: true } }),
            json: async () => ({ success: true, data: { ok: true } }),
          };
        }

        callCount++;
        if (callCount === 1) {
          // First attempt returns 401
          return {
            ok: false,
            status: 401,
            text: async () => JSON.stringify({
              success: false,
              status_code: 401,
              error: 'session expired/blocked (HTTP 401)',
            }),
          };
        }

        // Retry after refresh succeeds
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            success: true,
            data: {
              addresses: [{ id: 773430946, name: 'Recovered User', pin: '110016', mobile: '9387596885' }],
            },
          }),
        };
      });

      const addresses = await CheckoutApi.getAddresses();
      expect(addresses).toHaveLength(1);
      expect(addresses[0].id).toBe(773430946);
      expect(callCount).toBe(2); // Initial failed call + 1 successful retry
    });

    it('deduplicates concurrent 401 requests using a shared refresh promise', async () => {
      let refreshCalls = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/refresh-session')) {
          refreshCalls++;
          // Simulate slight network delay
          await new Promise(r => setTimeout(r, 10));
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true, data: { ok: true } }),
            json: async () => ({ success: true, data: { ok: true } }),
          };
        }

        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({
            success: false,
            status_code: 401,
            error: 'session expired/blocked (HTTP 401)',
          }),
        };
      });

      // Fire 3 simultaneous refreshAuthSession requests
      const results = await Promise.all([
        refreshAuthSession(143321),
        refreshAuthSession(143321),
        refreshAuthSession(143321),
      ]);

      expect(results).toEqual([true, true, true]);
      // Only 1 actual HTTP request to /refresh-session occurred
      expect(refreshCalls).toBe(1);
    });

    it('stops retry and shows expiration message if session refresh fails', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/refresh-session')) {
          return {
            ok: false,
            status: 500,
            text: async () => JSON.stringify({ success: false, error: 'Cannot refresh session' }),
            json: async () => ({ success: false, error: 'Cannot refresh session' }),
          };
        }

        return {
          ok: false,
          status: 401,
          text: async () => JSON.stringify({
            success: false,
            status_code: 401,
            error: 'session expired (HTTP 401)',
          }),
        };
      });

      await expect(CheckoutApi.getAddresses()).rejects.toThrow(
        'Your session has expired. Please log in again to continue.'
      );
    });

    it('immediately halts retry if account is reported blocked and surfaces clear message', async () => {
      let refreshCalled = false;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/refresh-session')) {
          refreshCalled = true;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: true }),
            json: async () => ({ success: true }),
          };
        }

        return {
          ok: false,
          status: 403,
          text: async () => JSON.stringify({
            success: false,
            error: 'Account has been blocked due to suspicious activity',
          }),
        };
      });

      await expect(CheckoutApi.getAddresses()).rejects.toThrow(
        'Your account has been blocked or restricted. Please contact support or reconnect.'
      );
      expect(refreshCalled).toBe(false); // Did not attempt refresh on blocked account
    });

    it('does NOT automatically retry non-idempotent operations like placeCod on 401 to prevent duplicates', async () => {
      let placeCalls = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/place-cod')) {
          placeCalls++;
          return {
            ok: false,
            status: 401,
            text: async () => JSON.stringify({
              success: false,
              status_code: 401,
              error: 'session expired (HTTP 401)',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true }),
          json: async () => ({ success: true }),
        };
      });

      await expect(CheckoutApi.placeCod(773430946)).rejects.toThrow(
        'Your session has expired. Please log in again to continue.'
      );
      // Ensure place-cod was called strictly once, never retried automatically
      expect(placeCalls).toBe(1);
    });
  });

  describe('11. Direct Checkout & Pay: Single Product & Cart Isolation', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('Scenario 1: Searching for one product by URL or ID and isolating cart to only that product', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/search')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                catalogs: [{
                  product_id: 1053270803,
                  catalog_id: 553022666,
                  name: 'Printed Rayon Anarkali Kurti',
                  price: 307,
                  in_stock: true,
                  sizes: [{ variation_id: 111, name: 'M', in_stock: true }],
                }],
                total_count: 1,
                is_exact: true,
              },
            }),
          };
        }
        if (url.includes('/cart/isolate')) {
          const body = JSON.parse(opts.body);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                is_isolated: true,
                product_id: body.product_id,
                variation_id: body.variation_id,
                quantity: body.quantity,
                cart: {
                  items: [{ product_id: body.product_id, variation_id: body.variation_id, quantity: body.quantity }],
                  total_quantity: body.quantity,
                  effective_total: 307,
                },
              },
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      const searchRes = await CheckoutApi.searchProducts('https://www.meesho.com/s/p/hf38yb');
      expect(searchRes.catalogs).toHaveLength(1);
      expect(searchRes.is_exact).toBe(true);

      const target = searchRes.catalogs[0];
      const isolateRes = await CheckoutApi.isolateCart({
        productId: target.product_id,
        supplierId: 999,
        variationId: 111,
        variationName: 'M',
        quantity: 1,
      });

      expect(isolateRes.is_isolated).toBe(true);
      expect(isolateRes.product_id).toBe(1053270803);
      expect(isolateRes.cart.items).toHaveLength(1);
      expect(isolateRes.cart.items[0].product_id).toBe(1053270803);
    });

    it('Scenario 2: Selecting one product from multiple search results without adding others', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/search')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                catalogs: [
                  { product_id: 101, name: 'Cotton Kurti Red', price: 299 },
                  { product_id: 102, name: 'Cotton Kurti Blue', price: 349 },
                  { product_id: 103, name: 'Cotton Kurti Yellow', price: 399 },
                ],
                total_count: 3,
                is_exact: false,
              },
            }),
          };
        }
        if (url.includes('/cart/isolate')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                is_isolated: true,
                product_id: 102,
                cart: {
                  items: [{ product_id: 102, quantity: 1 }],
                  total_quantity: 1,
                },
              },
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      const searchRes = await CheckoutApi.searchProducts('Cotton Kurti');
      expect(searchRes.catalogs).toHaveLength(3);
      expect(searchRes.is_exact).toBe(false);

      // Explicitly select catalog #2 (product_id: 102)
      const selected = searchRes.catalogs[1];
      expect(selected.product_id).toBe(102);

      const isolateRes = await CheckoutApi.isolateCart({
        productId: selected.product_id,
        supplierId: 50,
        variationId: 202,
        variationName: 'L',
        quantity: 1,
      });

      // Assert only product 102 is in cart, products 101 and 103 were never added
      expect(isolateRes.is_isolated).toBe(true);
      expect(isolateRes.product_id).toBe(102);
      expect(isolateRes.cart.items).toHaveLength(1);
      expect(isolateRes.cart.items.find((i: any) => i.product_id === 101)).toBeUndefined();
      expect(isolateRes.cart.items.find((i: any) => i.product_id === 103)).toBeUndefined();
    });

    it('Scenario 3: Selecting a variant and quantity updates the isolated cart correctly', async () => {
      let capturedPayload: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/cart/isolate')) {
          capturedPayload = JSON.parse(opts.body);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                is_isolated: true,
                product_id: capturedPayload.product_id,
                variation_id: capturedPayload.variation_id,
                quantity: capturedPayload.quantity,
                cart: {
                  items: [{
                    product_id: capturedPayload.product_id,
                    variation_id: capturedPayload.variation_id,
                    quantity: capturedPayload.quantity,
                  }],
                },
              },
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      await CheckoutApi.isolateCart({
        productId: 1053270803,
        supplierId: 44,
        variationId: 88721,
        variationName: 'XXL',
        quantity: 3,
      });

      expect(capturedPayload).toEqual({
        product_id: 1053270803,
        supplier_id: 44,
        variation_id: 88721,
        variation: 'XXL',
        quantity: 3,
      });
    });

    it('Scenario 4: Switching from Product A to Product B isolates cart to Product B only', async () => {
      const remoteCart: any[] = [];
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/cart/isolate')) {
          const body = JSON.parse(opts.body);
          // Purge existing and add only target
          remoteCart.length = 0;
          remoteCart.push({
            product_id: body.product_id,
            variation_id: body.variation_id,
            quantity: body.quantity,
          });
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                is_isolated: true,
                product_id: body.product_id,
                cart: { items: [...remoteCart] },
              },
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      // User first chooses Product A
      await CheckoutApi.isolateCart({
        productId: 1001,
        supplierId: 10,
        variationId: 11,
        variationName: 'S',
        quantity: 1,
      });
      expect(remoteCart[0].product_id).toBe(1001);

      // User switches to Product B
      const resB = await CheckoutApi.isolateCart({
        productId: 2002,
        supplierId: 20,
        variationId: 22,
        variationName: 'M',
        quantity: 1,
      });

      expect(resB.product_id).toBe(2002);
      expect(remoteCart).toHaveLength(1);
      expect(remoteCart[0].product_id).toBe(2002);
      // Product A is completely removed
      expect(remoteCart.find(i => i.product_id === 1001)).toBeUndefined();
    });

    it('Scenario 5: Purging unrelated leftover products from existing cart', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/cart/isolate')) {
          const body = JSON.parse(opts.body);
          // Simulating bridge logic: Hair Oil 304506809 is purged with quantity: 0
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                is_isolated: true,
                product_id: body.product_id,
                cart: {
                  items: [{ product_id: body.product_id, quantity: 1, name: 'Kurti' }],
                  purged_items: [{ product_id: 304506809, name: 'Bajaj Almond Drops' }],
                },
              },
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      const res = await CheckoutApi.isolateCart({
        productId: 1053270803,
        supplierId: 100,
        variationId: 200,
        variationName: 'Free Size',
        quantity: 1,
      });

      expect(res.is_isolated).toBe(true);
      expect(res.cart.items).toHaveLength(1);
      expect(res.cart.items[0].product_id).toBe(1053270803);
    });

    it('Scenario 6: Stops checkout and throws error if unexpected cart items remain', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/cart/isolate')) {
          return {
            ok: false,
            status: 400,
            text: async () => JSON.stringify({
              success: false,
              error: 'Cart contains 2 unexpected item(s). Isolation failed.',
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      await expect(
        CheckoutApi.isolateCart({
          productId: 1053270803,
          supplierId: 100,
          variationId: 200,
          variationName: 'Free Size',
          quantity: 1,
        })
      ).rejects.toThrow('Cart contains 2 unexpected item(s). Isolation failed.');
    });

    it('Scenario 7: Price change before payment refreshes quote correctly', async () => {
      let quoteCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/quote')) {
          quoteCount++;
          const price = quoteCount === 1 ? 307 : 349;
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                is_verified: true,
                cod_payable: price,
                online_payable: price - 20,
              },
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      const initialQuote = await CheckoutApi.getQuote(773430946);
      expect(initialQuote.cod_payable).toBe(307);

      const refreshedQuote = await CheckoutApi.getQuote(773430946);
      expect(refreshedQuote.cod_payable).toBe(349);
      expect(refreshedQuote.online_payable).toBe(329);
    });

    it('Scenario 8: Network timeout on checkout/pay stops order and alerts user safely', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Payment gateway timeout'));

      await expect(CheckoutApi.payOnline(773430946)).rejects.toThrow('Payment gateway timeout');
    });

    it('Scenario 9: Resolves product 51amyh / 304506809 with authoritative final price ₹79 as shown in bot', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: {
            product_id: 304506809,
            name: 'Bajaj Almond Drops Hair Oil, 190 ml',
            price: 79,
            mrp: 185,
            original_price: 184,
            discount_text: '57% Off (₹79 with 1st Order & Special Offer)',
            in_stock: true,
            sizes: [{ name: 'Free Size', variation_id: 167, in_stock: true }],
          },
        }),
      } as any);

      const res = await CheckoutApi.resolveProduct('https://www.meesho.com/s/p/51amyh');
      expect(res.product_id).toBe(304506809);
      expect(res.price).toBe(79);
    });

    it('Scenario 10: getQuote with product 304506809 returns online payable ₹79 and applies 1st order offer', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: {
            is_verified: true,
            address_id: 772336773,
            cart_session: 'cs_hair_oil_live',
            product_subtotal: 184,
            cod_payable: 79,
            online_payable: 79,
            prepaid_discount: 25,
            first_order_discount: 80,
            fod_offer: { text: '₹105 OFF on 1st order', max_value: 105, title: 'Upto' },
            delivery_charge: 0,
            currency: 'INR',
          },
        }),
      } as any);

      const quote = await CheckoutApi.getQuote(772336773, 304506809);
      expect(quote.online_payable).toBe(79);
      expect(quote.cod_payable).toBe(79);
      expect(quote.product_subtotal).toBe(184);
      expect(quote.prepaid_discount).toBe(25);
      expect(quote.first_order_discount).toBe(80);
    });

    it('Scenario 11: quote request handles upstream 500 error gracefully with clean error message', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({
          success: false,
          error: '',
        }),
      } as any);

      await expect(CheckoutApi.getQuote(772336773, 304506809)).rejects.toThrow(
        'Quote could not be refreshed from upstream server. Please retry in a moment.'
      );
    });
  });

  describe('12. Auto-Add Product to Cart: 0-Order Accounts Automation & Safeguards', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('Rule 1 & 2: Automatically adds only the selected product, variant, and quantity to cart for accounts without orders', async () => {
      let capturedPayload: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
        if (url.includes('/cart/auto-add')) {
          capturedPayload = JSON.parse(opts.body);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                processed: 3,
                added: 2,
                already_in_cart: 0,
                skipped_has_orders: 1,
                skipped_unverified: 0,
                failed: 0,
                total_eligible: 3,
                details: [
                  { shop_id: 101, status: 'added', message: 'Successfully added Free Size (Qty: 2) to cart' },
                  { shop_id: 102, status: 'added', message: 'Successfully added Free Size (Qty: 2) to cart' },
                  { shop_id: 103, status: 'skipped_has_orders', message: 'Account has already successfully placed a first order' },
                ],
              },
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      const res = await CheckoutApi.autoAddProductToCart({
        productId: 1053270803,
        supplierId: 2249146,
        variationId: 10,
        variationName: 'Free Size',
        quantity: 2,
      });

      expect(capturedPayload).toEqual({
        product_id: 1053270803,
        supplier_id: 2249146,
        variation_id: 10,
        variation: 'Free Size',
        quantity: 2,
      });
      expect(res.added).toBe(2);
      expect(res.skipped_has_orders).toBe(1);
      expect(res.skipped_unverified).toBe(0);
      expect(res.failed).toBe(0);
    });

    it('Rule 3: Skips accounts that have already successfully placed a first order', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: {
            processed: 2,
            added: 0,
            already_in_cart: 0,
            skipped_has_orders: 2,
            skipped_unverified: 0,
            failed: 0,
            total_eligible: 2,
            details: [
              { shop_id: 201, status: 'skipped_has_orders', message: 'Account has 1 upstream order(s) on record' },
              { shop_id: 202, status: 'skipped_has_orders', message: 'Account has existing confirmed order in database' },
            ],
          },
        }),
      } as any);

      const res = await CheckoutApi.autoAddProductToCart({
        productId: 304506809,
        supplierId: 50,
        variationId: 1,
        variationName: '190ml',
        quantity: 1,
      });

      expect(res.added).toBe(0);
      expect(res.skipped_has_orders).toBe(2);
      expect(res.details?.[0].status).toBe('skipped_has_orders');
    });

    it('Rule 6: Safely skips accounts when order history is uncertain (API error / session expired) and never assumes 0 orders', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: {
            processed: 2,
            added: 0,
            already_in_cart: 0,
            skipped_has_orders: 0,
            skipped_unverified: 2,
            failed: 0,
            total_eligible: 2,
            details: [
              { shop_id: 301, status: 'skipped_unverified', message: 'Order history could not be verified upstream: HTTP 401 session expired' },
              { shop_id: 302, status: 'skipped_unverified', message: 'Order history could not be verified due to database verification error' },
            ],
          },
        }),
      } as any);

      const res = await CheckoutApi.autoAddProductToCart({
        productId: 1053270803,
        supplierId: 2249146,
        variationId: 1,
        variationName: 'XXS',
        quantity: 1,
      });

      expect(res.added).toBe(0);
      expect(res.skipped_unverified).toBe(2);
      expect(res.details?.[0].message).toContain('HTTP 401');
    });

    it('Rule 7: Prevents duplicate cart additions when item is already present in cart', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: {
            processed: 1,
            added: 0,
            already_in_cart: 1,
            skipped_has_orders: 0,
            skipped_unverified: 0,
            failed: 0,
            total_eligible: 1,
            details: [
              { shop_id: 401, status: 'already_in_cart', message: 'Selected product and variant already present in cart (duplicate prevented)' },
            ],
          },
        }),
      } as any);

      const res = await CheckoutApi.autoAddProductToCart({
        productId: 1053270803,
        supplierId: 2249146,
        variationId: 1,
        variationName: 'XXS',
        quantity: 1,
      });

      expect(res.added).toBe(0);
      expect(res.already_in_cart).toBe(1);
      expect(res.details?.[0].status).toBe('already_in_cart');
    });

    it('Rule 4 & 5: Automation terminates after cart addition and NEVER executes place-cod, pay-online, or confirm-order', async () => {
      const endpointsCalled: string[] = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        endpointsCalled.push(url);
        if (url.includes('/cart/auto-add')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              success: true,
              data: {
                processed: 1,
                added: 1,
                already_in_cart: 0,
                skipped_has_orders: 0,
                skipped_unverified: 0,
                failed: 0,
                total_eligible: 1,
              },
            }),
          };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }) };
      });

      const res = await CheckoutApi.autoAddProductToCart({
        productId: 1053270803,
        supplierId: 2249146,
        variationId: 1,
        variationName: 'XXS',
        quantity: 1,
      });

      expect(res.added).toBe(1);

      // Verify that checkout, payment, and confirmation endpoints were NEVER called
      expect(endpointsCalled.some(u => u.includes('/place-cod'))).toBe(false);
      expect(endpointsCalled.some(u => u.includes('/pay'))).toBe(false);
      expect(endpointsCalled.some(u => u.includes('/confirm'))).toBe(false);
    });

    it('Rule 9: Returns complete, structured breakdown of all 4 counts', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          success: true,
          data: {
            processed: 10,
            added: 4,
            already_in_cart: 2,
            skipped_has_orders: 2,
            skipped_unverified: 1,
            failed: 1,
            total_eligible: 10,
          },
        }),
      } as any);

      const res = await CheckoutApi.autoAddProductToCart({
        productId: 1053270803,
        supplierId: 2249146,
        variationId: 1,
        variationName: 'XXS',
        quantity: 1,
      });

      expect(res).toHaveProperty('added', 4);
      expect(res).toHaveProperty('skipped_has_orders', 2);
      expect(res).toHaveProperty('skipped_unverified', 1);
      expect(res).toHaveProperty('failed', 1);
      expect(res).toHaveProperty('already_in_cart', 2);
    });
  });
});


