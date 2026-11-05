import React, { useState, useEffect } from 'react';
import { OrderRecord, OrderRefundStatus } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import {
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Calendar,
  Search,
} from 'lucide-react';

export const ReturnsRefundsView: React.FC = () => {
  const { dataVersion, showToast, refreshData } = useApp();

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'processing' | 'refunded' | 'failed' | 'overdue'>('all');
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  // Follow-up resolution modal
  const [activeOrder, setActiveOrder] = useState<OrderRecord | null>(null);
  const [refundStatus, setRefundStatus] = useState<OrderRefundStatus>('pending');
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundRef, setRefundRef] = useState<string>('');
  const [followUpNote, setFollowUpNote] = useState<string>('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    StorageService.getOrders({ search }).then(all => {
      if (isMounted) {
        // Return cases are those with return_status != none or refund_status != none
        const returnCases = all.filter(o => o.return_status !== 'none' || o.refund_status !== 'none');
        setOrders(returnCases);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [search, dataVersion]);

  const handleOpenFollowUp = (ord: OrderRecord) => {
    setActiveOrder(ord);
    setRefundStatus(ord.refund_status);
    setRefundAmount(ord.refund_amount ? String(ord.refund_amount) : String(ord.order_amount));
    setRefundRef(ord.refund_reference || '');
    setFollowUpNote('');
    setNextFollowUpDate(ord.next_follow_up_date?.slice(0, 10) || '');
  };

  const handleSaveFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    try {
      const amt = parseFloat(refundAmount) || 0;
      const noteStr = followUpNote
        ? `[Refund Follow-up]: ${followUpNote} (Ref: ${refundRef || 'None'})`
        : undefined;

      await StorageService.updateOrderStatus(
        activeOrder.id,
        undefined,
        refundStatus,
        noteStr
      );

      showToast(`Updated refund case for ${activeOrder.account_phone || activeOrder.id}`, 'success', true);
      refreshData();
      setActiveOrder(null);
    } catch {
      showToast('Failed to update refund case', 'error');
    }
  };

  const filteredOrders = orders.filter(o => {
    if (filter === 'all') return true;
    if (filter === 'overdue') {
      if (!o.next_follow_up_date) return false;
      return new Date(o.next_follow_up_date).getTime() < Date.now() && o.refund_status !== 'refunded';
    }
    return o.refund_status === filter;
  });

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">Returns and Refund Workspace</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Track customer return reasons, follow-up deadlines, payment gateway reversals, and refund status transitions.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {[
            { id: 'all', label: 'All Cases' },
            { id: 'pending', label: 'Pending Reversal' },
            { id: 'processing', label: 'In Processing' },
            { id: 'refunded', label: 'Completed' },
            { id: 'failed', label: 'Disputed / Failed' },
            { id: 'overdue', label: 'Overdue Follow-ups' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                filter === tab.id
                  ? 'bg-pink-700 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search return cases..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-4">Order ID</th>
                <th className="py-3.5 px-4">Account Mobile</th>
                <th className="py-3.5 px-4">Product & Reason</th>
                <th className="py-3.5 px-4">Refund Amount</th>
                <th className="py-3.5 px-4">Refund Status</th>
                <th className="py-3.5 px-4">Next Follow-Up</th>
                <th className="py-3.5 px-4 text-right pr-6">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Loading cases...
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No return or refund cases found.
                  </td>
                </tr>
              ) : (
                filteredOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">
                      {order.external_order_id || order.id}
                    </td>

                    <td className="py-3.5 px-4 font-mono font-semibold text-pink-300">
                      {order.account_phone || 'Unlinked'}
                    </td>

                    <td className="py-3.5 px-4 max-w-xs">
                      <p className="text-slate-200 font-medium truncate">{order.product_name}</p>
                      <p className="text-[11px] text-amber-300/80 italic mt-0.5">
                        {order.return_reason || 'Return requested by buyer'}
                      </p>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-bold text-slate-100">
                      ₹{(order.refund_amount || order.order_amount).toFixed(2)}
                      {order.refund_reference && (
                        <span className="block text-[10px] text-slate-500 font-mono font-normal">
                          Ref: {order.refund_reference}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <Badge
                        variant={
                          order.refund_status === 'refunded'
                            ? 'success'
                            : order.refund_status === 'failed'
                            ? 'danger'
                            : 'warning'
                        }
                        size="sm"
                      >
                        {order.refund_status}
                      </Badge>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px]">
                      {order.next_follow_up_date ? (
                        <span
                          className={
                            new Date(order.next_follow_up_date).getTime() < Date.now() &&
                            order.refund_status !== 'refunded'
                              ? 'text-rose-400 font-bold'
                              : 'text-slate-400'
                          }
                        >
                          {new Date(order.next_follow_up_date).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right pr-6">
                      <button
                        onClick={() => handleOpenFollowUp(order)}
                        className="px-2.5 py-1 rounded bg-pink-950/80 hover:bg-pink-900/80 text-pink-300 border border-pink-700/60 transition-colors cursor-pointer"
                      >
                        Follow-Up
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Follow-up Resolution Modal */}
      <Modal
        isOpen={Boolean(activeOrder)}
        onClose={() => setActiveOrder(null)}
        title="Refund Follow-Up & Resolution"
        subtitle={`Case for ${activeOrder?.account_phone || activeOrder?.id}`}
        maxWidth="md"
      >
        <form onSubmit={handleSaveFollowUp} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Refund Status
            </label>
            <select
              value={refundStatus}
              onChange={e => setRefundStatus(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 font-medium"
            >
              <option value="pending">Pending Reversal</option>
              <option value="processing">In Processing with Bank/Gateway</option>
              <option value="refunded">Refunded (Verified Confirmation)</option>
              <option value="failed">Failed / Gateway Disputed</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Refund Amount (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={refundAmount}
                onChange={e => setRefundAmount(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Bank / UPI Ref #
              </label>
              <input
                type="text"
                value={refundRef}
                onChange={e => setRefundRef(e.target.value)}
                placeholder="UPI-TXN-..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Next Follow-Up Date
            </label>
            <input
              type="date"
              value={nextFollowUpDate}
              onChange={e => setNextFollowUpDate(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Case Log Notes
            </label>
            <textarea
              value={followUpNote}
              onChange={e => setFollowUpNote(e.target.value)}
              placeholder="e.g. Bank customer service reached. RTO package physically received at warehouse..."
              rows={2}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setActiveOrder(null)}
              className="px-4 py-2 text-xs text-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold"
            >
              Save Follow-up Details
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
