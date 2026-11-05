import React from 'react';
import { CheckoutQuote } from '../../types';
import { ShieldCheck, AlertCircle, RefreshCw, Sparkles, CheckCircle2 } from 'lucide-react';

interface PriceCardProps {
  quote: CheckoutQuote | null;
  loading: boolean;
  error?: string | null;
  paymentMethod: 'online' | 'cod';
  onSelectPaymentMethod: (method: 'online' | 'cod') => void;
  onRefreshQuote: () => void;
  selectedAddressId: number | null;
  preliminaryPrice?: number;
}

export const PriceCard: React.FC<PriceCardProps> = ({
  quote,
  loading,
  error,
  paymentMethod,
  onSelectPaymentMethod,
  onRefreshQuote,
  selectedAddressId,
  preliminaryPrice,
}) => {
  const isVerified = Boolean(quote?.is_verified && selectedAddressId);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-100 text-base">Payment & Price Summary</h3>
          {isVerified ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
              <CheckCircle2 className="w-3 h-3" /> Verified Server Quote
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/80 text-amber-400 border border-amber-800/60">
              <AlertCircle className="w-3 h-3" /> Estimated Total
            </span>
          )}
        </div>

        <button
          onClick={onRefreshQuote}
          disabled={loading}
          className="p-1.5 text-slate-400 hover:text-pink-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          title="Refresh quote from server"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-pink-400' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-rose-950/50 border border-rose-800/60 rounded-lg text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={onRefreshQuote}
            className="text-xs text-rose-200 underline font-medium hover:text-white ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Payment Method Selector */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
          Choose Payment Method
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onSelectPaymentMethod('online')}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer relative ${
              paymentMethod === 'online'
                ? 'border-pink-500 bg-pink-950/30 text-white shadow-sm ring-1 ring-pink-500/50'
                : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <div className="font-medium text-sm flex items-center justify-between">
              <span>UPI / Google Pay</span>
              {quote && (quote.prepaid_discount ?? 0) > 0 && (
                <span className="text-[10px] bg-pink-600/30 text-pink-300 px-1.5 py-0.5 rounded border border-pink-500/30 font-semibold">
                  Save ₹{quote.prepaid_discount}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-1">Prepaid discount applied</div>
          </button>

          <button
            type="button"
            onClick={() => onSelectPaymentMethod('cod')}
            className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
              paymentMethod === 'cod'
                ? 'border-pink-500 bg-pink-950/30 text-white shadow-sm ring-1 ring-pink-500/50'
                : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <div className="font-medium text-sm">Cash on Delivery</div>
            <div className="text-xs text-slate-400 mt-1">Pay upon delivery</div>
          </button>
        </div>
      </div>

      {/* Itemized Price Breakdown */}
      <div className="space-y-2 text-sm border-t border-slate-800/80 pt-3">
        <div className="flex justify-between text-slate-400">
          <span>Product Subtotal</span>
          <span className="font-mono text-slate-200">
            ₹{quote?.product_subtotal ?? preliminaryPrice ?? 0}
          </span>
        </div>

        <div className="flex justify-between text-slate-400">
          <span>Delivery & Handling</span>
          <span className="font-mono text-slate-200">
            {quote?.delivery_charge && quote.delivery_charge > 0
              ? `₹${quote.delivery_charge}`
              : 'FREE'}
          </span>
        </div>

        {quote?.fod_offer && (
          <div className="flex justify-between text-emerald-400">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              1st Order Offer ({quote.fod_offer.text || 'Eligible'})
            </span>
            <span className="font-mono font-medium">
              {quote.first_order_discount && quote.first_order_discount > 0
                ? `- ₹${quote.first_order_discount}`
                : 'Applied'}
            </span>
          </div>
        )}

        {paymentMethod === 'online' && quote && (quote.prepaid_discount ?? 0) > 0 && (
          <div className="flex justify-between text-pink-400">
            <span>Prepaid UPI Discount</span>
            <span className="font-mono font-medium">- ₹{quote.prepaid_discount}</span>
          </div>
        )}

        <div className="flex justify-between text-slate-400">
          <span>Service Fee / Wallet Fee</span>
          <span className="font-mono text-emerald-400 font-medium">₹0 (No ₹10 Bot Fee)</span>
        </div>

        <div className="border-t border-slate-800 pt-2.5 mt-2 flex justify-between items-baseline">
          <div>
            <span className="text-base font-bold text-slate-100">
              {paymentMethod === 'online' ? 'Online Payable Amount' : 'COD Payable Amount'}
            </span>
            {!isVerified && (
              <span className="block text-[11px] text-amber-400/90 font-medium">
                * Select delivery address for final verified quote
              </span>
            )}
          </div>
          <div className="text-right">
            <span className="font-mono text-xl font-extrabold text-pink-400">
              ₹{paymentMethod === 'online'
                ? quote?.online_payable ?? preliminaryPrice ?? 0
                : quote?.cod_payable ?? preliminaryPrice ?? 0}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-pink-400" />
          <span>NPCI Standard End-to-End Encryption</span>
        </div>
        {quote?.cart_session && (
          <span className="font-mono text-[10px] text-slate-400 truncate max-w-[140px]" title={quote.cart_session}>
            Session: {quote.cart_session.slice(0, 10)}...
          </span>
        )}
      </div>
    </div>
  );
};
