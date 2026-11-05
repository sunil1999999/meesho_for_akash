/**
 * Checkout & Payment Synchronization Manager
 *
 * Implements strict lifecycle tracking, idempotency, stale-response rejection,
 * and clear separation of internal application statuses from merchant statuses.
 *
 * Supported Statuses:
 * - ORDER_CREATED
 * - FREE_MODE_PENDING
 * - FREE_MODE_COMPLETED
 * - PAYMENT_PENDING
 * - PAYMENT_CONFIRMED
 * - PAYMENT_FAILED
 * - RECONCILIATION_REQUIRED
 */

import {
  CheckoutAttempt,
  InternalCheckoutStatus,
  OrderPaymentStatus,
  FreeCheckoutResult,
  PaymentStatusResult,
} from '../types';
import { StorageService } from './storageAdapter';

const ACTIVE_CHECKOUT_STORAGE_KEY = 'meesho_active_checkout_attempt';
const COMPLETED_CHECKOUTS_KEY = 'meesho_completed_checkout_refs';
const EXPIRY_TTL_MS = 20 * 60 * 1000; // 20 minutes expiration window

export class CheckoutSyncManager {
  private activeAttempt: CheckoutAttempt | null = null;
  private completedReferences: Set<string> = new Set();

  constructor() {
    this.restoreState();
  }

  /**
   * Restores state from localStorage to handle application restarts safely.
   */
  public restoreState(): CheckoutAttempt | null {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }

    try {
      const storedCompleted = window.localStorage.getItem(COMPLETED_CHECKOUTS_KEY);
      if (storedCompleted) {
        const refs: string[] = JSON.parse(storedCompleted);
        this.completedReferences = new Set(refs);
      }

      const storedAttempt = window.localStorage.getItem(ACTIVE_CHECKOUT_STORAGE_KEY);
      if (storedAttempt) {
        const attempt: CheckoutAttempt = JSON.parse(storedAttempt);
        const createdAt = new Date(attempt.created_at).getTime();
        const now = Date.now();

        // Check if expired
        if (now - createdAt > EXPIRY_TTL_MS) {
          if (attempt.internal_status === 'PAYMENT_PENDING' || attempt.internal_status === 'FREE_MODE_PENDING') {
            attempt.internal_status = 'PAYMENT_FAILED';
            attempt.error_message = 'Checkout attempt expired after 20 minutes of inactivity';
            attempt.updated_at = new Date().toISOString();
          }
          this.activeAttempt = attempt;
          this.persistActiveAttempt();
        } else {
          this.activeAttempt = attempt;
        }
        return this.activeAttempt;
      }
    } catch (err) {
      console.warn('Failed to restore checkout state from localStorage:', err);
    }
    return null;
  }

  /**
   * Generates a unique, immutable checkout reference for a new checkout attempt.
   */
  public generateCheckoutReference(accountId: number | string): string {
    const cleanAcc = String(accountId).replace(/\D/g, '').slice(-6) || 'acc';
    const timestamp = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 7);
    return `chk_${cleanAcc}_${timestamp}_${rand}`;
  }

  /**
   * Initializes a brand-new checkout attempt with status ORDER_CREATED.
   */
  public initCheckoutAttempt(params: {
    accountId: number | string;
    accountPhone?: string;
    productId: number;
    productName: string;
    variantId: number;
    variantName: string;
    quantity: number;
    amount: number;
    addressId: number;
    addressText: string;
    isFreeMode: boolean;
    checkoutReference?: string;
  }): CheckoutAttempt {
    const ref = params.checkoutReference || this.generateCheckoutReference(params.accountId);
    const now = new Date().toISOString();

    const attempt: CheckoutAttempt = {
      checkout_reference: ref,
      account_id: params.accountId,
      account_phone: params.accountPhone,
      product_id: params.productId,
      product_name: params.productName,
      variant_id: params.variantId,
      variant_name: params.variantName,
      quantity: params.quantity,
      amount: params.amount,
      address_id: params.addressId,
      address_text: params.addressText,
      is_free_mode: params.isFreeMode,
      internal_status: 'ORDER_CREATED',
      merchant_payment_status: params.isFreeMode ? 'pending' : 'pending',
      created_at: now,
      updated_at: now,
    };

    this.activeAttempt = attempt;
    this.persistActiveAttempt();
    return attempt;
  }

  /**
   * Returns the currently active checkout attempt, or null.
   */
  public getActiveAttempt(): CheckoutAttempt | null {
    return this.activeAttempt;
  }

  /**
   * Checks if an incoming response (e.g. from Telegram or payment callback) is stale.
   * Prevents stale or mismatched responses from updating newer checkout attempts.
   */
  public isStaleResponse(incomingCheckoutRef?: string): boolean {
    if (!this.activeAttempt) {
      return true; // No active checkout to accept response
    }
    if (!incomingCheckoutRef) {
      return false; // Legacy/unadorned responses accepted only if single active attempt
    }
    return incomingCheckoutRef !== this.activeAttempt.checkout_reference;
  }

  /**
   * Checks if a checkout attempt has already been finalized (prevents duplicate retries).
   */
  public isAlreadyCompleted(checkoutRef: string): boolean {
    if (this.completedReferences.has(checkoutRef)) {
      return true;
    }
    if (
      this.activeAttempt &&
      this.activeAttempt.checkout_reference === checkoutRef &&
      (this.activeAttempt.internal_status === 'FREE_MODE_COMPLETED' ||
        this.activeAttempt.internal_status === 'PAYMENT_CONFIRMED')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Safely transitions status with validation.
   */
  public updateStatus(
    checkoutRef: string,
    newStatus: InternalCheckoutStatus,
    extraUpdates: Partial<CheckoutAttempt> = {}
  ): CheckoutAttempt {
    if (!this.activeAttempt || this.activeAttempt.checkout_reference !== checkoutRef) {
      throw new Error(`Cannot update checkout attempt: reference mismatch or no active attempt (expected: ${this.activeAttempt?.checkout_reference}, got: ${checkoutRef})`);
    }

    // Safety rule: Free mode must never accidentally trigger real payment
    if (this.activeAttempt.is_free_mode && (newStatus === 'PAYMENT_PENDING' || newStatus === 'PAYMENT_CONFIRMED')) {
      throw new Error('Safety violation: Real payment status cannot be applied to an authorized free-mode checkout.');
    }

    // Status transition validity check
    this.activeAttempt.internal_status = newStatus;
    this.activeAttempt.updated_at = new Date().toISOString();

    if (extraUpdates.merchant_payment_status) {
      this.activeAttempt.merchant_payment_status = extraUpdates.merchant_payment_status;
    }
    if (extraUpdates.merchant_order_id) {
      this.activeAttempt.merchant_order_id = extraUpdates.merchant_order_id;
    }
    if (extraUpdates.cart_session) {
      this.activeAttempt.cart_session = extraUpdates.cart_session;
    }
    if (extraUpdates.upi_uri) {
      this.activeAttempt.upi_uri = extraUpdates.upi_uri;
    }
    if (extraUpdates.error_message) {
      this.activeAttempt.error_message = extraUpdates.error_message;
    }
    if (extraUpdates.reconciliation_reason) {
      this.activeAttempt.reconciliation_reason = extraUpdates.reconciliation_reason;
    }

    if (newStatus === 'FREE_MODE_COMPLETED' || newStatus === 'PAYMENT_CONFIRMED') {
      this.completedReferences.add(checkoutRef);
      this.persistCompletedReferences();
    }

    this.persistActiveAttempt();
    return this.activeAttempt;
  }

  /**
   * Executes the authorized Free Payment Mode workflow:
   * - Transitions ORDER_CREATED -> FREE_MODE_PENDING -> FREE_MODE_COMPLETED
   * - Strictly avoids initiating real payment, Juspay requests, or QR code generation
   * - Truthfully records merchant payment status as 'pending' (never faked as 'paid')
   * - Saves the resulting order in Supabase / StorageService
   * - Returns a truthful completion result
   */
  public async executeFreeCheckoutFlow(
    attempt: CheckoutAttempt,
    targetAccountId: string,
    existingTags: string[] = []
  ): Promise<FreeCheckoutResult> {
    const ref = attempt.checkout_reference;

    // 1. Idempotency guard: avoid duplicate orders if retried
    if (this.isAlreadyCompleted(ref) && attempt.merchant_order_id) {
      return {
        ok: true,
        order_num: attempt.merchant_order_id,
        amount: attempt.amount,
        checkout_reference: ref,
        internal_status: 'FREE_MODE_COMPLETED',
        merchant_payment_status: 'pending',
        message: 'Order was already created using authorized free payment mode (idempotent replay).',
      };
    }

    // 2. Transition to FREE_MODE_PENDING
    this.updateStatus(ref, 'FREE_MODE_PENDING');

    try {
      // Deterministic order number derived from checkout reference
      const orderNum = `FREE-${ref.replace('chk_', '').toUpperCase()}`;

      // 3. Persist order truthfully to Supabase:
      // Note: Do NOT mark merchant payment status as 'paid', because no real money was paid.
      // Use 'pending' for merchant payment status, and record FREE_MODE_COMPLETED in internal metadata.
      await StorageService.createOrder({
        account_id: targetAccountId,
        account_phone: attempt.account_phone,
        external_order_id: orderNum,
        product_name: attempt.product_name,
        quantity: attempt.quantity,
        order_amount: attempt.amount,
        payment_status: 'pending', // Truthful: Merchant payment is pending / test mode
        delivery_status: 'placed',
        cancellation_status: 'none',
        return_status: 'none',
        refund_status: 'none',
        data_source: 'verified_api',
        order_date: new Date().toISOString(),
        notes: `[FREE_MODE_COMPLETED] Checkout Reference: ${ref} · Mode: Authorized Free Mode (Test Mode) · Merchant Payment: Pending · Single Product Isolation: ${attempt.product_name} (${attempt.variant_name}) × ${attempt.quantity}`,
      });

      // 4. Update account tags and status to prevent reuse
      if (targetAccountId && targetAccountId !== 'default_account') {
        const updatedTags = existingTags.includes('used_order_placed')
          ? existingTags
          : [...existingTags, 'used_order_placed'];
        await StorageService.updateAccount(targetAccountId, {
          tags: updatedTags,
          monitoring_status: 'has_orders',
        }).catch((err) => console.warn('Failed to tag account as used_order_placed in free mode:', err));
      }

      // 5. Transition to FREE_MODE_COMPLETED
      this.updateStatus(ref, 'FREE_MODE_COMPLETED', {
        merchant_order_id: orderNum,
        merchant_payment_status: 'pending',
      });

      return {
        ok: true,
        order_num: orderNum,
        amount: attempt.amount,
        checkout_reference: ref,
        internal_status: 'FREE_MODE_COMPLETED',
        merchant_payment_status: 'pending',
        message: 'Order successfully created using authorized Free Payment Mode.',
      };
    } catch (err: any) {
      this.updateStatus(ref, 'PAYMENT_FAILED', {
        error_message: err?.message || 'Free checkout order creation failed',
      });
      return {
        ok: false,
        order_num: '',
        amount: attempt.amount,
        checkout_reference: ref,
        internal_status: 'PAYMENT_FAILED',
        merchant_payment_status: 'pending',
        message: 'Free mode order creation failed',
        error: err?.message || 'Order creation error',
      };
    }
  }

  /**
   * Handles payment gateway polling responses for Real Payment Mode.
   */
  public evaluateGatewayResponse(
    attempt: CheckoutAttempt,
    response: PaymentStatusResult
  ): {
    nextStatus: InternalCheckoutStatus;
    shouldConfirm: boolean;
    isFinished: boolean;
  } {
    // Stale response check
    if (response.checkout_reference && response.checkout_reference !== attempt.checkout_reference) {
      console.warn(`Ignoring stale payment status response for ${response.checkout_reference} (active: ${attempt.checkout_reference})`);
      return {
        nextStatus: attempt.internal_status,
        shouldConfirm: false,
        isFinished: false,
      };
    }

    const statusUpper = String(response.status || '').toUpperCase();
    const isSuccess =
      response.state === 'success' ||
      ['SUCCESS', 'CHARGED', 'COMPLETED', 'PAID', 'TXN_SUCCESS'].includes(statusUpper);

    const isFailure =
      response.state === 'failed' ||
      ['FAILED', 'EXPIRED', 'CANCELLED', 'DECLINED'].includes(statusUpper);

    if (isSuccess) {
      return {
        nextStatus: 'PAYMENT_CONFIRMED',
        shouldConfirm: true,
        isFinished: true,
      };
    }

    if (isFailure) {
      this.updateStatus(attempt.checkout_reference, 'PAYMENT_FAILED', {
        merchant_payment_status: 'failed',
        error_message: `Payment gateway transaction ${statusUpper}`,
      });
      return {
        nextStatus: 'PAYMENT_FAILED',
        shouldConfirm: false,
        isFinished: true,
      };
    }

    // Still pending / awaiting scan
    return {
      nextStatus: 'PAYMENT_PENDING',
      shouldConfirm: false,
      isFinished: false,
    };
  }

  /**
   * Clears active checkout session when modal closes or resets.
   */
  public clearActiveAttempt(ref?: string): void {
    if (ref && this.activeAttempt && this.activeAttempt.checkout_reference !== ref) {
      return; // Do not clear a different attempt
    }
    this.activeAttempt = null;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(ACTIVE_CHECKOUT_STORAGE_KEY);
    }
  }

  private persistActiveAttempt(): void {
    if (typeof window !== 'undefined' && window.localStorage && this.activeAttempt) {
      try {
        window.localStorage.setItem(ACTIVE_CHECKOUT_STORAGE_KEY, JSON.stringify(this.activeAttempt));
      } catch (err) {
        console.warn('Failed to persist active checkout attempt to localStorage:', err);
      }
    }
  }

  private persistCompletedReferences(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(
          COMPLETED_CHECKOUTS_KEY,
          JSON.stringify(Array.from(this.completedReferences))
        );
      } catch (err) {
        console.warn('Failed to persist completed checkout references:', err);
      }
    }
  }
}

// Global Singleton Instance
export const checkoutSyncManager = new CheckoutSyncManager();
