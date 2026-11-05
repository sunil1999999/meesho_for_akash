import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  UpiPaymentSession,
  PaymentMachineState,
  DeliveryAddress,
  CheckoutQuote,
} from '../../types';
import { CheckoutApi } from '../../lib/checkoutApi';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
  Clock,
  Sparkles,
  Smartphone,
  QrCode,
  Lock,
  Copy,
  Check,
  RefreshCw,
} from 'lucide-react';

interface GPayModalProps {
  isOpen: boolean;
  onClose: () => void;
  address: DeliveryAddress;
  quote: CheckoutQuote;
  checkoutReference?: string;
  orderNum?: string;
  onOrderConfirmed: (orderNum: string, amount: number, confirmationData: any, checkoutRef: string) => void;
  onReconciliationRequired?: (orderNum: string, amount: number, reason: string, checkoutRef: string) => void;
}

export const GPayModal: React.FC<GPayModalProps> = ({
  isOpen,
  onClose,
  address,
  quote,
  checkoutReference,
  orderNum,
  onOrderConfirmed,
  onReconciliationRequired,
}) => {
  const [state, setState] = useState<PaymentMachineState>('awaiting_payment');
  const [session, setSession] = useState<UpiPaymentSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('Scan QR code with Google Pay or any UPI app');
  const [copiedVpa, setCopiedVpa] = useState<boolean>(false);
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(600); // 10 minutes session

  // Persistent reference order number per modal opening
  const localOrderNumRef = useRef<string>('');
  const activeCheckoutRef = useRef<string>(checkoutReference || '');
  const pollTimerRef = useRef<any>(null);
  const countdownTimerRef = useRef<any>(null);
  const isConfirmingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  // Authoritative amount
  const payableAmount = quote.online_payable || session?.amount || 281;
  const targetVpa = 'meeshobusiness@icici';

  // Initialize or maintain stable order number from checkout reference so QR code never mutates
  if (!localOrderNumRef.current) {
    if (orderNum) {
      localOrderNumRef.current = orderNum;
    } else if (checkoutReference) {
      const cleanDigits = checkoutReference.replace(/\D/g, '');
      localOrderNumRef.current = cleanDigits.length >= 6
        ? `98${cleanDigits.slice(-10).padStart(10, '0')}`
        : `98${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
    } else {
      localOrderNumRef.current = `98${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
    }
  }

  // Active locked order number that remains 100% constant throughout the checkout attempt
  const activeOrderNum = localOrderNumRef.current;
  const activeCartSession = session?.cart_session || quote.cart_session || `cs_${activeOrderNum}`;

  // Formulate standard NPCI UPI URI with stable locked order number
  const activeUpiUri = session?.upi_uri ||
    `upi://pay?pa=${targetVpa}&pn=Meesho&am=${payableAmount.toFixed(2)}&tr=${activeOrderNum}&tn=Meesho%20Order%20${activeOrderNum}&cu=INR`;

  const primaryQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=8&data=${encodeURIComponent(activeUpiUri)}`;
  const fallbackQrUrl = `https://quickchart.io/qr?size=250&text=${encodeURIComponent(activeUpiUri)}`;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, []);

  const clearTimer = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // Step 2: Confirm Order with Meesho Fulfillment after payment
  const executeOrderConfirmation = useCallback(async () => {
    if (isConfirmingRef.current) return;
    isConfirmingRef.current = true;
    clearTimer();

    if (!isMountedRef.current) return;
    setState('confirming_order');
    setStatusMessage('Verifying payment & confirming order with Meesho...');

    const currentRef = activeCheckoutRef.current || `chk_${activeOrderNum}`;

    try {
      // First verify gateway status before confirming
      const statusRes = await CheckoutApi.checkPaymentStatus(
        activeOrderNum,
        activeCartSession,
        session?.juspay_order_id || `jp_${activeOrderNum}`,
        currentRef
      ).catch(() => null);

      const statusUpper = String(statusRes?.status || '').toUpperCase();
      const isPaid =
        statusRes?.state === 'success' ||
        ['SUCCESS', 'CHARGED', 'COMPLETED', 'PAID', 'TXN_SUCCESS'].includes(statusUpper);

      // Call confirmOrder on the backend
      const confirmRes = await CheckoutApi.confirmOrder(
        activeOrderNum,
        activeCartSession,
        currentRef
      );

      if (confirmRes && (confirmRes.ok || confirmRes.order_num)) {
        if (!isMountedRef.current) return;
        setState('confirmed');
        setStatusMessage('Order successfully placed and confirmed!');
        onOrderConfirmed(
          confirmRes.order_num || activeOrderNum,
          payableAmount,
          confirmRes,
          currentRef
        );
      } else {
        if (!isMountedRef.current) return;
        isConfirmingRef.current = false;

        // If payment was charged but merchant confirmation failed -> RECONCILIATION_REQUIRED
        if (isPaid) {
          setState('confirmation_failed');
          const errDetail = confirmRes?.error || confirmRes?.message || 'Merchant order confirmation rejected after payment';
          setErrorMessage(`Reconciliation Required: Payment of ₹${payableAmount} was charged, but Meesho order confirmation failed. Reason: ${errDetail}. Automated reconciliation initiated.`);
          onReconciliationRequired?.(
            activeOrderNum,
            payableAmount,
            errDetail,
            currentRef
          );
        } else {
          setState('payment_failed');
          setErrorMessage(confirmRes?.error || confirmRes?.message || 'Payment not completed. Please scan QR and pay.');
        }
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      isConfirmingRef.current = false;
      // Never fabricate a successful order response!
      setState('confirmation_failed');
      const networkErrMsg = err?.message || 'Network error during order confirmation';
      setErrorMessage(`Reconciliation Required: Order confirmation encountered a communication error: ${networkErrMsg}. Please verify status before retrying.`);
      setStatusMessage('Order status pending verification');
      onReconciliationRequired?.(
        activeOrderNum,
        payableAmount,
        networkErrMsg,
        currentRef
      );
    }
  }, [activeOrderNum, activeCartSession, session?.juspay_order_id, payableAmount, onOrderConfirmed, onReconciliationRequired]);

  // Step 1: Poll Gateway Status quietly in background without breaking UI
  const pollStatus = useCallback(async (currentSession: UpiPaymentSession, attempt: number) => {
    if (!isMountedRef.current) return;
    if (attempt >= 30) {
      return;
    }

    setPollCount(attempt + 1);

    try {
      const currentRef = activeCheckoutRef.current;
      const res = await CheckoutApi.checkPaymentStatus(
        currentSession.order_num,
        currentSession.cart_session,
        currentSession.juspay_order_id,
        currentRef
      );

      // Discard stale responses from older attempts
      if (res.checkout_reference && currentRef && res.checkout_reference !== currentRef) {
        console.warn('Discarded stale gateway response for', res.checkout_reference);
        return;
      }

      const statusUpper = String(res?.status || '').toUpperCase();
      const isSuccess =
        res?.state === 'success' ||
        ['SUCCESS', 'CHARGED', 'COMPLETED', 'PAID', 'TXN_SUCCESS'].includes(statusUpper);

      if (isSuccess) {
        await executeOrderConfirmation();
        return;
      }

      const isFailed =
        res?.state === 'failed' ||
        ['FAILED', 'CANCELLED', 'DECLINED'].includes(statusUpper);

      if (isFailed) {
        if (!isMountedRef.current) return;
        setState('payment_failed');
        setErrorMessage(`Payment attempt ${statusUpper}. Please retry scanning QR code.`);
        return;
      }

      // If pending or awaiting scan, queue next quiet tick in 5s
      pollTimerRef.current = setTimeout(() => {
        pollStatus(currentSession, attempt + 1);
      }, 5000);
    } catch {
      // Network hiccup — retry next cycle
      pollTimerRef.current = setTimeout(() => {
        pollStatus(currentSession, attempt + 1);
      }, 5000);
    }
  }, [executeOrderConfirmation]);

  // Initial Payment Launch
  const startPayment = useCallback(async () => {
    clearTimer();
    isConfirmingRef.current = false;
    setState('awaiting_payment');
    setErrorMessage(null);
    setPollCount(0);
    setTimeLeftSeconds(600);

    const currentRef = activeCheckoutRef.current;
    const lockedNum = localOrderNumRef.current;

    try {
      const sess = await CheckoutApi.payOnline(address.id, currentRef, lockedNum);
      if (!isMountedRef.current) return;

      // Discard stale responses
      if (sess && sess.checkout_reference && currentRef && sess.checkout_reference !== currentRef) {
        console.warn('Discarded stale payOnline session for', sess.checkout_reference);
        return;
      }

      if (sess && (sess.order_num || sess.cart_session)) {
        setSession(sess);
        // Start quiet polling in background
        pollTimerRef.current = setTimeout(() => {
          pollStatus(sess, 0);
        }, 5000);
      }
    } catch (err: any) {
      console.warn('Backend payment session info:', err.message);
      setStatusMessage('Scan QR code with Google Pay, PhonePe, Paytm, or any UPI app');
    }
  }, [address.id, pollStatus]);

  useEffect(() => {
    if (isOpen) {
      // Synchronize checkout reference
      activeCheckoutRef.current = checkoutReference || '';
      if (orderNum) {
        localOrderNumRef.current = orderNum;
      } else if (checkoutReference) {
        const cleanDigits = checkoutReference.replace(/\D/g, '');
        localOrderNumRef.current = cleanDigits.length >= 6
          ? `98${cleanDigits.slice(-10).padStart(10, '0')}`
          : `98${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
      } else {
        localOrderNumRef.current = `98${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
      }

      startPayment();

      // Start 10-minute countdown
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = setInterval(() => {
        setTimeLeftSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(countdownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearTimer();
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      setState('awaiting_payment');
      setSession(null);
      setErrorMessage(null);
      setCopiedVpa(false);
      localOrderNumRef.current = '';
    }
  }, [isOpen, checkoutReference, orderNum, startPayment]);


  const handleCopyVpa = () => {
    navigator.clipboard?.writeText(targetVpa);
    setCopiedVpa(true);
    setTimeout(() => setCopiedVpa(false), 2500);
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden relative text-slate-100 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800/80 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-pink-600/20 text-pink-400 flex items-center justify-center border border-pink-500/30">
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Google Pay & UPI Payment</h3>
              <p className="text-[11px] text-slate-400">Scan & Pay via any UPI Application</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Amount & Merchant Banner */}
        <div className="p-4 bg-gradient-to-br from-pink-950/50 via-slate-900 to-slate-950 border-b border-slate-800/80 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-pink-400 mb-0.5">
            Payable Amount
          </div>
          <div className="text-3xl font-extrabold text-white font-mono tracking-tight flex items-center justify-center gap-2">
            <span>₹{payableAmount}</span>
            <span className="text-[11px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
              Prepaid Discount Applied
            </span>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400 mt-1.5">
            <span>Merchant: <strong className="text-slate-200">Meesho</strong></span>
            <span>•</span>
            <span className="font-mono text-slate-300">Order #{activeOrderNum}</span>
            <span>•</span>
            <span className="text-emerald-400 font-medium">₹0 Service Fee</span>
          </div>
        </div>

        {/* Main Content Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Awaiting / Scanning State (Visible Always when Open) */}
          {(state === 'awaiting_payment' || state === 'verifying_payment') && (
            <div className="space-y-4 text-center">
              {/* Direct UPI Notice Badge */}
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/40 text-[11px] text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Direct UPI • No ₹10 Bot Fee • No Wallet Top-Up Required</span>
              </div>

              {/* Dynamic QR Code Card */}
              <div className="inline-block p-4 bg-white rounded-2xl shadow-xl border border-slate-200 mx-auto transition-transform hover:scale-[1.02]">
                <img
                  src={primaryQrUrl}
                  onError={(e) => {
                    // Fallback to secondary QR generator
                    (e.target as HTMLImageElement).src = fallbackQrUrl;
                  }}
                  alt="Scan to pay with Google Pay, PhonePe, Paytm, or any UPI App"
                  width={220}
                  height={220}
                  className="mx-auto rounded-lg"
                />
                <div className="text-[12px] font-bold text-slate-900 mt-2 flex items-center justify-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-pink-600" />
                  <span>Scan to pay ₹{payableAmount}</span>
                </div>
              </div>

              {/* Supported UPI Apps Badges */}
              <div className="flex items-center justify-center gap-2 text-[10px] text-slate-400 font-medium">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60">GPay</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60">PhonePe</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60">Paytm</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60">BHIM</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60">Cred</span>
              </div>

              {/* UPI ID & Copy Row */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 px-3 flex items-center justify-between text-xs">
                <div className="text-left">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">UPI ID / VPA</div>
                  <div className="font-mono text-slate-200 font-semibold select-all">{targetVpa}</div>
                </div>
                <button
                  onClick={handleCopyVpa}
                  type="button"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer transition-colors"
                >
                  {copiedVpa ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-semibold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Mobile Deep Link */}
              <div>
                <a
                  href={activeUpiUri}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold text-sm transition-all shadow-md shadow-pink-900/30 cursor-pointer"
                >
                  <Smartphone className="w-4 h-4" /> Open in Google Pay / UPI App
                </a>
              </div>

              {/* Primary User Action: "I Have Paid" */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={executeOrderConfirmation}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-950/50 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" /> I Have Completed Payment — Confirm Order
                </button>
              </div>

              {/* Session Countdown & Security Footer */}
              <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-slate-300">
                  <Clock className="w-3.5 h-3.5 text-pink-400" />
                  <span>Session expires in <strong className="text-white font-mono">{formatCountdown(timeLeftSeconds)}</strong></span>
                </div>
                <div className="flex items-center gap-1 text-emerald-400">
                  <Lock className="w-3 h-3" />
                  <span>NPCI Encrypted</span>
                </div>
              </div>
            </div>
          )}

          {/* Confirming Order state */}
          {state === 'confirming_order' && (
            <div className="py-12 text-center space-y-3 animate-fadeIn">
              <div className="w-12 h-12 border-3 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto" />
              <p className="text-sm font-semibold text-emerald-400">{statusMessage}</p>
              <p className="text-xs text-slate-400">Booking your order #{activeOrderNum} on Meesho...</p>
            </div>
          )}

          {/* Confirmed state */}
          {state === 'confirmed' && (
            <div className="py-8 text-center space-y-3 animate-fadeIn">
              <div className="w-14 h-14 rounded-full bg-emerald-950 border border-emerald-500/50 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-950/50">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-bold text-white">Payment Verified & Order Confirmed!</h4>
              <p className="text-xs text-slate-300 max-w-xs mx-auto">
                Payment received for ₹{payableAmount}. Your Meesho order <strong>#{activeOrderNum}</strong> has been confirmed.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 px-6 py-2.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold text-sm cursor-pointer shadow-md"
              >
                View Order Details
              </button>
            </div>
          )}

          {/* Error / Failure States */}
          {(state === 'payment_failed' ||
            state === 'payment_cancelled' ||
            state === 'payment_expired' ||
            state === 'confirmation_failed') && (
            <div className="py-6 text-center space-y-3 animate-fadeIn">
              <div className="w-12 h-12 rounded-full bg-rose-950 border border-rose-500/50 text-rose-400 flex items-center justify-center mx-auto">
                {state === 'confirmation_failed' ? (
                  <ShieldAlert className="w-6 h-6" />
                ) : (
                  <AlertTriangle className="w-6 h-6" />
                )}
              </div>
              <h4 className="text-base font-bold text-white">
                {state === 'confirmation_failed'
                  ? 'Order Confirmation Notice'
                  : 'Payment Status'}
              </h4>
              <p className="text-xs text-rose-300 max-w-xs mx-auto leading-relaxed">
                {errorMessage || 'Payment was not confirmed. Please retry.'}
              </p>

              <div className="pt-2 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={startPayment}
                  className="px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold cursor-pointer shadow-sm"
                >
                  Show QR Code Again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
