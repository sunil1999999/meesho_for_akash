import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentConfig } from '../lib/paymentConfig';
import { CheckoutSyncManager } from '../lib/checkoutSyncManager';
import { StorageService } from '../lib/storageAdapter';
import { CheckoutAttempt, PaymentStatusResult } from '../types';

describe('Free Payment Mode & Checkout Synchronization Test Suite', () => {
  let syncManager: CheckoutSyncManager;
  let mockStore: Record<string, string> = {};

  const mockLocalStorage = {
    getItem: (key: string) => mockStore[key] ?? null,
    setItem: (key: string, val: string) => { mockStore[key] = String(val); },
    removeItem: (key: string) => { delete mockStore[key]; },
    clear: () => { mockStore = {}; },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockStore = {};
    (globalThis as any).localStorage = mockLocalStorage;
    (globalThis as any).window = { localStorage: mockLocalStorage };
    syncManager = new CheckoutSyncManager();
  });

  describe('1. Free Payment Mode Configuration & Switching', () => {
    it('defaults to true or environment setting and persists state', () => {
      PaymentConfig.setFreePaymentMode(true);
      expect(PaymentConfig.isFreePaymentMode()).toBe(true);
      expect(localStorage.getItem('meesho_free_payment_mode')).toBe('true');

      PaymentConfig.setFreePaymentMode(false);
      expect(PaymentConfig.isFreePaymentMode()).toBe(false);
      expect(localStorage.getItem('meesho_free_payment_mode')).toBe('false');
    });

    it('notifies subscribers when payment mode switches', () => {
      const listener = vi.fn();
      const unsubscribe = PaymentConfig.subscribe(listener);

      PaymentConfig.setFreePaymentMode(true);
      expect(listener).toHaveBeenCalledWith(true);

      PaymentConfig.setFreePaymentMode(false);
      expect(listener).toHaveBeenCalledWith(false);

      unsubscribe();
      PaymentConfig.setFreePaymentMode(true);
      expect(listener).toHaveBeenCalledTimes(2); // No new calls after unsubscribe
    });

    it('resets to default and clears localStorage', () => {
      PaymentConfig.setFreePaymentMode(false);
      expect(PaymentConfig.isFreePaymentMode()).toBe(false);

      PaymentConfig.resetToDefault();
      expect(localStorage.getItem('meesho_free_payment_mode')).toBeNull();
    });
  });

  describe('2. Authorized Free Payment Workflow Execution', () => {
    it('executes free checkout without QR generation or real payment requests', async () => {
      const createOrderSpy = vi.spyOn(StorageService, 'createOrder').mockResolvedValue({
        id: 'mock-order-id',
        order_number: 'FREE-CHK-123',
        status: 'placed',
      } as any);

      const updateAccountSpy = vi.spyOn(StorageService, 'updateAccount').mockResolvedValue({} as any);

      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_7230986965',
        accountPhone: '7230986965',
        productId: 1053270803,
        productName: "Women's Casual Kurti",
        variantId: 3,
        variantName: 'S',
        quantity: 1,
        amount: 512,
        addressId: 768709375,
        addressText: 'DRM Office, Ahmedabad',
        isFreeMode: true,
      });

      expect(attempt.internal_status).toBe('ORDER_CREATED');
      expect(attempt.is_free_mode).toBe(true);
      expect(attempt.checkout_reference).toMatch(/^chk_/);

      const result = await syncManager.executeFreeCheckoutFlow(attempt, 'acc_7230986965', ['test_account']);

      // 1. Result must confirm free mode completion
      expect(result.ok).toBe(true);
      expect(result.internal_status).toBe('FREE_MODE_COMPLETED');
      expect(result.merchant_payment_status).toBe('pending');
      expect(result.order_num).toContain('FREE-');

      // 2. Verified StorageService order persistence
      expect(createOrderSpy).toHaveBeenCalledTimes(1);
      const savedPayload = createOrderSpy.mock.calls[0][0];
      expect(savedPayload.account_id).toBe('acc_7230986965');
      expect(savedPayload.account_phone).toBe('7230986965');
      // Crucial requirement: Must NOT fake a paid status; merchant payment is truthfully pending
      expect(savedPayload.payment_status).toBe('pending');
      expect(savedPayload.notes).toContain('[FREE_MODE_COMPLETED]');
      expect(savedPayload.notes).toContain('Mode: Authorized Free Mode (Test Mode)');

      // 3. Account tagged as used_order_placed
      expect(updateAccountSpy).toHaveBeenCalledWith('acc_7230986965', {
        tags: ['test_account', 'used_order_placed'],
        monitoring_status: 'has_orders',
      });
    });

    it('enforces safety violation if real payment status is applied to free mode attempt', () => {
      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_123',
        productId: 101,
        productName: 'Sample Product',
        variantId: 1,
        variantName: 'M',
        quantity: 1,
        amount: 299,
        addressId: 456,
        addressText: 'Mumbai',
        isFreeMode: true,
      });

      expect(() => {
        syncManager.updateStatus(attempt.checkout_reference, 'PAYMENT_PENDING');
      }).toThrow(/Safety violation: Real payment status cannot be applied/);

      expect(() => {
        syncManager.updateStatus(attempt.checkout_reference, 'PAYMENT_CONFIRMED');
      }).toThrow(/Safety violation: Real payment status cannot be applied/);
    });

    it('handles failures gracefully without crashing and marks PAYMENT_FAILED', async () => {
      vi.spyOn(StorageService, 'createOrder').mockRejectedValue(new Error('Database disk full'));

      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_fail',
        productId: 101,
        productName: 'Sample Product',
        variantId: 1,
        variantName: 'M',
        quantity: 1,
        amount: 299,
        addressId: 456,
        addressText: 'Mumbai',
        isFreeMode: true,
      });

      const result = await syncManager.executeFreeCheckoutFlow(attempt, 'acc_fail');

      expect(result.ok).toBe(false);
      expect(result.internal_status).toBe('PAYMENT_FAILED');
      expect(result.error).toBe('Database disk full');
      expect(syncManager.getActiveAttempt()?.internal_status).toBe('PAYMENT_FAILED');
    });
  });

  describe('3. Real Payment Mode Workflow & Gateway Polling', () => {
    it('manages normal payment mode with PAYMENT_PENDING and confirms upon gateway SUCCESS', () => {
      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_real',
        productId: 202,
        productName: 'Premium Saree',
        variantId: 5,
        variantName: 'Free Size',
        quantity: 1,
        amount: 850,
        addressId: 789,
        addressText: 'Bengaluru',
        isFreeMode: false,
      });

      expect(attempt.internal_status).toBe('ORDER_CREATED');
      expect(attempt.is_free_mode).toBe(false);

      // Transition to PAYMENT_PENDING with UPI URI
      syncManager.updateStatus(attempt.checkout_reference, 'PAYMENT_PENDING', {
        upi_uri: 'upi://pay?pa=meesho@axisbank&pn=Meesho&am=850.00&tr=chk_123',
      });
      expect(syncManager.getActiveAttempt()?.internal_status).toBe('PAYMENT_PENDING');
      expect(syncManager.getActiveAttempt()?.upi_uri).toContain('upi://pay');

      // 1. Gateway response pending
      const pendingResponse: PaymentStatusResult = {
        order_num: 'MEESHO-998877',
        state: 'pending',
        status: 'PENDING_USER_INPUT',
        checkout_reference: attempt.checkout_reference,
      };
      const evalPending = syncManager.evaluateGatewayResponse(attempt, pendingResponse);
      expect(evalPending.nextStatus).toBe('PAYMENT_PENDING');
      expect(evalPending.shouldConfirm).toBe(false);
      expect(evalPending.isFinished).toBe(false);

      // 2. Gateway response success (CHARGED)
      const successResponse: PaymentStatusResult = {
        order_num: 'MEESHO-998877',
        state: 'success',
        status: 'CHARGED',
        checkout_reference: attempt.checkout_reference,
      };
      const evalSuccess = syncManager.evaluateGatewayResponse(attempt, successResponse);
      expect(evalSuccess.nextStatus).toBe('PAYMENT_CONFIRMED');
      expect(evalSuccess.shouldConfirm).toBe(true);
      expect(evalSuccess.isFinished).toBe(true);

      // Update to confirmed
      syncManager.updateStatus(attempt.checkout_reference, 'PAYMENT_CONFIRMED', {
        merchant_payment_status: 'paid',
        merchant_order_id: 'MEESHO-998877',
      });
      expect(syncManager.getActiveAttempt()?.internal_status).toBe('PAYMENT_CONFIRMED');
      expect(syncManager.getActiveAttempt()?.merchant_payment_status).toBe('paid');
    });

    it('handles payment gateway failure correctly', () => {
      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_fail',
        productId: 202,
        productName: 'Premium Saree',
        variantId: 5,
        variantName: 'Free Size',
        quantity: 1,
        amount: 850,
        addressId: 789,
        addressText: 'Bengaluru',
        isFreeMode: false,
      });

      const failedResponse: PaymentStatusResult = {
        order_num: 'MEESHO-FAIL-1',
        state: 'failed',
        status: 'FAILED',
        checkout_reference: attempt.checkout_reference,
      };

      const evalFailed = syncManager.evaluateGatewayResponse(attempt, failedResponse);
      expect(evalFailed.nextStatus).toBe('PAYMENT_FAILED');
      expect(evalFailed.shouldConfirm).toBe(false);
      expect(evalFailed.isFinished).toBe(true);
      expect(syncManager.getActiveAttempt()?.internal_status).toBe('PAYMENT_FAILED');
      expect(syncManager.getActiveAttempt()?.merchant_payment_status).toBe('failed');
    });

    it('transitions to RECONCILIATION_REQUIRED when gateway succeeds but merchant confirmation fails', () => {
      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_recon',
        productId: 202,
        productName: 'Premium Saree',
        variantId: 5,
        variantName: 'Free Size',
        quantity: 1,
        amount: 850,
        addressId: 789,
        addressText: 'Bengaluru',
        isFreeMode: false,
      });

      // Update to RECONCILIATION_REQUIRED with explicit reason
      syncManager.updateStatus(attempt.checkout_reference, 'RECONCILIATION_REQUIRED', {
        merchant_payment_status: 'pending',
        reconciliation_reason: 'Payment was charged by UPI/Juspay, but Meesho order confirmation timed out. Manual reconciliation required.',
      });

      const active = syncManager.getActiveAttempt();
      expect(active?.internal_status).toBe('RECONCILIATION_REQUIRED');
      expect(active?.reconciliation_reason).toContain('Payment was charged by UPI/Juspay');
      // Must NOT fabricate a confirmed order or fake a paid order
      expect(active?.merchant_payment_status).toBe('pending');
    });
  });

  describe('4. Idempotency & Stale Response Rejection', () => {
    it('detects and rejects stale responses from earlier or mismatched checkout references', () => {
      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_current',
        productId: 101,
        productName: 'Current Item',
        variantId: 1,
        variantName: 'M',
        quantity: 1,
        amount: 199,
        addressId: 123,
        addressText: 'Pune',
        isFreeMode: true,
      });

      // Mismatched reference from an older attempt
      const staleRef = 'chk_old_ref_999';
      expect(syncManager.isStaleResponse(staleRef)).toBe(true);

      // Current active reference
      expect(syncManager.isStaleResponse(attempt.checkout_reference)).toBe(false);

      // If no active attempt exists, all responses are considered stale
      syncManager.clearActiveAttempt();
      expect(syncManager.isStaleResponse(attempt.checkout_reference)).toBe(true);
    });

    it('gateway evaluator ignores responses with mismatched checkout references', () => {
      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_active',
        productId: 101,
        productName: 'Active Item',
        variantId: 1,
        variantName: 'M',
        quantity: 1,
        amount: 199,
        addressId: 123,
        addressText: 'Pune',
        isFreeMode: false,
      });

      const staleSuccessResponse: PaymentStatusResult = {
        order_num: 'MEESHO-STALE',
        state: 'success',
        status: 'CHARGED',
        checkout_reference: 'chk_other_stale_ref',
      };

      const result = syncManager.evaluateGatewayResponse(attempt, staleSuccessResponse);
      // Status must not change; confirmation must not be triggered
      expect(result.shouldConfirm).toBe(false);
      expect(result.isFinished).toBe(false);
      expect(syncManager.getActiveAttempt()?.internal_status).toBe('ORDER_CREATED');
    });

    it('prevents duplicate order creation when free checkout is retried (idempotent replay)', async () => {
      const createOrderSpy = vi.spyOn(StorageService, 'createOrder').mockResolvedValue({} as any);

      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_idempotent',
        productId: 101,
        productName: 'Item',
        variantId: 1,
        variantName: 'M',
        quantity: 1,
        amount: 299,
        addressId: 123,
        addressText: 'Delhi',
        isFreeMode: true,
      });

      // First run
      const result1 = await syncManager.executeFreeCheckoutFlow(attempt, 'acc_idempotent');
      expect(result1.ok).toBe(true);
      expect(createOrderSpy).toHaveBeenCalledTimes(1);
      expect(syncManager.isAlreadyCompleted(attempt.checkout_reference)).toBe(true);

      // Second run (duplicate retry)
      const result2 = await syncManager.executeFreeCheckoutFlow(attempt, 'acc_idempotent');
      expect(result2.ok).toBe(true);
      expect(result2.message).toContain('idempotent replay');
      // Crucial: createOrder must NOT be called a second time
      expect(createOrderSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('5. Application Restarts & State Persistence', () => {
    it('restores active checkout attempt from localStorage across application restarts', () => {
      const attempt = syncManager.initCheckoutAttempt({
        accountId: 'acc_restart',
        productId: 303,
        productName: 'Restartable Item',
        variantId: 2,
        variantName: 'L',
        quantity: 2,
        amount: 600,
        addressId: 444,
        addressText: 'Kolkata',
        isFreeMode: true,
      });

      // Simulate browser refresh by creating a new manager instance
      const newManager = new CheckoutSyncManager();
      const restored = newManager.getActiveAttempt();

      expect(restored).not.toBeNull();
      expect(restored?.checkout_reference).toBe(attempt.checkout_reference);
      expect(restored?.account_id).toBe('acc_restart');
      expect(restored?.product_name).toBe('Restartable Item');
      expect(restored?.internal_status).toBe('ORDER_CREATED');
    });

    it('marks pending checkout as PAYMENT_FAILED if expired after 20 minutes of inactivity', () => {
      const pastTime = new Date(Date.now() - 25 * 60 * 1000).toISOString(); // 25 minutes ago
      const expiredAttempt: CheckoutAttempt = {
        checkout_reference: 'chk_expired_123',
        account_id: 'acc_exp',
        product_id: 111,
        product_name: 'Expired Item',
        variant_id: 1,
        variant_name: 'S',
        quantity: 1,
        amount: 400,
        address_id: 555,
        address_text: 'Chennai',
        is_free_mode: false,
        internal_status: 'PAYMENT_PENDING',
        merchant_payment_status: 'pending',
        created_at: pastTime,
        updated_at: pastTime,
      };

      localStorage.setItem('meesho_active_checkout_attempt', JSON.stringify(expiredAttempt));

      const newManager = new CheckoutSyncManager();
      const restored = newManager.getActiveAttempt();

      expect(restored).not.toBeNull();
      expect(restored?.internal_status).toBe('PAYMENT_FAILED');
      expect(restored?.error_message).toContain('expired after 20 minutes');
    });
  });

  describe('6. Stable Order Numbers & Concurrency Isolation', () => {
    it('generates unique, collision-resistant checkout references with account context', () => {
      const ref1 = syncManager.generateCheckoutReference('7230986965');
      const ref2 = syncManager.generateCheckoutReference('7230986965');
      const ref3 = syncManager.generateCheckoutReference('9876543210');

      expect(ref1).not.toBe(ref2);
      expect(ref1).toContain('chk_986965_');
      expect(ref3).toContain('chk_543210_');
    });

    it('rejects updateStatus calls targeting non-active or mismatched checkout references', () => {
      syncManager.initCheckoutAttempt({
        accountId: 'acc_a',
        productId: 1,
        productName: 'A',
        variantId: 1,
        variantName: 'S',
        quantity: 1,
        amount: 100,
        addressId: 1,
        addressText: 'Addr A',
        isFreeMode: true,
      });

      expect(() => {
        syncManager.updateStatus('chk_wrong_ref', 'FREE_MODE_COMPLETED');
      }).toThrow(/reference mismatch/);
    });
  });
});
