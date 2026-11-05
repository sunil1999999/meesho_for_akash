import React, { useState, useEffect, useMemo } from 'react';
import { OrderRecord, OrderDeliveryStatus, OrderRefundStatus } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import {
  ShoppingBag,
  Search,
  Filter,
  Plus,
  Calendar,
  CheckCircle2,
  Clock,
  RotateCcw,
  Edit,
  Phone,
  PhoneOff,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

export const OrdersView: React.FC = () => {
  const { dataVersion, showToast, refreshData } = useApp();

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [mobileQuery, setMobileQuery] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'order_date' | 'order_amount' | 'account_phone' | 'product_name' | 'delivery_status'>('order_date');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [loading, setLoading] = useState<boolean>(true);

  // Status transition modal
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);
  const [newDeliveryStatus, setNewDeliveryStatus] = useState<OrderDeliveryStatus>('delivered');
  const [newRefundStatus, setNewRefundStatus] = useState<OrderRefundStatus>('none');
  const [editingTrackingId, setEditingTrackingId] = useState<string>('');
  const [statusNote, setStatusNote] = useState<string>('');

  // Create order modal
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [newAccountPhone, setNewAccountPhone] = useState<string>('+91 90338 07401');
  const [newProduct, setNewProduct] = useState<string>('');
  const [newAmount, setNewAmount] = useState<string>('799');
  const [newExternalId, setNewExternalId] = useState<string>('');
  const [newTrackingId, setNewTrackingId] = useState<string>('');

  // Fetch orders from StorageService with responsive search, mobile filter, and status filter
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    StorageService.getOrders({
      search: searchQuery,
      mobileSearch: mobileQuery,
      deliveryStatus: statusFilter === 'all' ? undefined : statusFilter,
    }).then(res => {
      if (isMounted) {
        setOrders(res);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [searchQuery, mobileQuery, statusFilter, dataVersion]);

  // Reset pagination to page 1 whenever any filter or search changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery, mobileQuery, statusFilter]);

  // Sorting
  const sortedOrders = useMemo(() => {
    const list = [...orders];
    list.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];

      if (sortField === 'order_date') {
        const timeA = new Date(valA || 0).getTime();
        const timeB = new Date(valB || 0).getTime();
        return sortAsc ? timeA - timeB : timeB - timeA;
      }
      if (sortField === 'order_amount') {
        return sortAsc ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
      }
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [orders, sortField, sortAsc]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedOrders.slice(start, start + pageSize);
  }, [sortedOrders, currentPage, pageSize]);

  const handleOpenStatusEdit = (order: OrderRecord) => {
    setEditingOrder(order);
    setNewDeliveryStatus(order.delivery_status);
    setNewRefundStatus(order.refund_status);
    setEditingTrackingId(order.tracking_id || '');
    setStatusNote('');
  };

  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    try {
      await StorageService.updateOrderStatus(
        editingOrder.id,
        newDeliveryStatus,
        newRefundStatus,
        statusNote || undefined,
        editingTrackingId || undefined
      );
      showToast(`Updated status for order ${editingOrder.external_order_id || editingOrder.id}`, 'success', true);
      refreshData();
      setEditingOrder(null);
    } catch {
      showToast('Failed to update status', 'error');
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProduct.trim() || !newAmount) return;
    try {
      // Find matching account ID
      const accountsRes = await StorageService.getAccounts({ search: newAccountPhone, pageSize: 1 });
      const accountId = accountsRes.accounts[0]?.id || 'acc_01_9033807401';

      await StorageService.createOrder({
        account_id: accountId,
        account_phone: newAccountPhone,
        external_order_id: newExternalId || `MSHO-${Date.now().toString().slice(-6)}`,
        product_name: newProduct,
        quantity: 1,
        order_amount: parseFloat(newAmount) || 0,
        payment_status: 'paid',
        tracking_id: newTrackingId.trim() || undefined,
        delivery_status: 'placed',
        cancellation_status: 'none',
        return_status: 'none',
        refund_status: 'none',
        order_date: new Date().toISOString(),
        data_source: 'manual',
      });

      showToast(`Created new order for ${newAccountPhone}`, 'success');
      refreshData();
      setIsCreateOpen(false);
      setNewProduct('');
      setNewExternalId('');
      setNewTrackingId('');
    } catch {
      showToast('Failed to create order', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">Order Management</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Track orders linked to verified accounts, manage transitions, delivery events, and search by customer mobile number.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-xl text-xs font-semibold shadow-md transition-all self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Order Entry</span>
        </button>
      </div>

      {/* Filter, Search & Sort Control Bar */}
      <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3 shadow-lg">
        {/* Top Row: Dual Search (Dedicated Mobile Search + General Search) + Sort Controls */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* 1. Dedicated Mobile Number Search */}
          <div className="md:col-span-5 relative">
            <Phone className="w-4 h-4 text-pink-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={mobileQuery}
              onChange={e => setMobileQuery(e.target.value)}
              placeholder="Search by customer mobile (e.g. 9033807401, +91 90338, 07401)..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-950 border border-pink-700/40 rounded-lg text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
            />
            {mobileQuery && (
              <button
                type="button"
                onClick={() => setMobileQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                title="Clear mobile search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 2. General Search (Order ID, Product Name, SKU) */}
          <div className="md:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter by Order ID, Tracking ID, product, SKU..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500 transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
                title="Clear query"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* 3. Sort Field & Direction */}
          <div className="md:col-span-3 flex items-center gap-1.5">
            <select
              value={sortField}
              onChange={e => setSortField(e.target.value as any)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 font-medium focus:outline-none cursor-pointer"
            >
              <option value="order_date">Sort: Order Date</option>
              <option value="order_amount">Sort: Amount</option>
              <option value="account_phone">Sort: Mobile</option>
              <option value="product_name">Sort: Product</option>
              <option value="delivery_status">Sort: Status</option>
            </select>
            <button
              type="button"
              onClick={() => setSortAsc(prev => !prev)}
              className="p-2 bg-slate-950 border border-slate-700 hover:bg-slate-800 text-slate-300 rounded-lg transition-colors cursor-pointer"
              title={sortAsc ? 'Ascending (Oldest / Low to High / A to Z)' : 'Descending (Newest / High to Low / Z to A)'}
            >
              {sortAsc ? <ArrowUp className="w-4 h-4 text-pink-400" /> : <ArrowDown className="w-4 h-4 text-pink-400" />}
            </button>
          </div>
        </div>

        {/* Bottom Row: Status Filter Pills + Active Filter Badges */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[11px] font-semibold text-slate-400 mr-1 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5 text-slate-500" /> Status:
            </span>
            {[
              { id: 'all', label: 'All' },
              { id: 'placed', label: 'Placed' },
              { id: 'confirmed', label: 'Confirmed' },
              { id: 'shipped', label: 'Shipped' },
              { id: 'out_for_delivery', label: 'Out for Delivery' },
              { id: 'delivered', label: 'Delivered' },
              { id: 'cancelled', label: 'Cancelled' },
              { id: 'returned', label: 'Returned' },
              { id: 'rto', label: 'RTO' },
            ].map(st => (
              <button
                key={st.id}
                onClick={() => setStatusFilter(st.id)}
                className={`px-2.5 py-1 rounded-lg font-medium text-xs transition-colors cursor-pointer ${
                  statusFilter === st.id
                    ? 'bg-pink-700 text-white shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {(mobileQuery || searchQuery || statusFilter !== 'all') && (
            <button
              onClick={() => {
                setMobileQuery('');
                setSearchQuery('');
                setStatusFilter('all');
              }}
              className="text-[11px] text-pink-400 hover:text-pink-300 underline font-medium self-end sm:self-auto cursor-pointer"
            >
              Clear all filters
            </button>
          )}
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-4">Order ID &amp; Placement</th>
                <th className="py-3.5 px-4">Customer Mobile</th>
                <th className="py-3.5 px-4">Product Details</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Tracking ID</th>
                <th className="py-3.5 px-4">Delivery Status</th>
                <th className="py-3.5 px-4">Refund Status</th>
                <th className="py-3.5 px-4 text-right pr-6">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    Loading orders...
                  </td>
                </tr>
              ) : sortedOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-14 text-center">
                    <div className="max-w-md mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400">
                        {mobileQuery.trim() ? (
                          <PhoneOff className="w-6 h-6 text-pink-400" />
                        ) : (
                          <Search className="w-6 h-6 text-slate-400" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-200">
                          {mobileQuery.trim()
                            ? `No orders found for mobile "${mobileQuery}"`
                            : 'No matching orders found'}
                        </h4>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          {mobileQuery.trim()
                            ? `No customer orders match this phone number in the "${statusFilter === 'all' ? 'any' : statusFilter}" status. Try searching with fewer digits, without country code, or select "All" statuses.`
                            : 'No orders match your active filter criteria. Try clearing search or selecting a different status filter.'}
                        </p>
                      </div>
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setMobileQuery('');
                            setSearchQuery('');
                            setStatusFilter('all');
                          }}
                          className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                        >
                          Reset All Filters
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedOrders.map(order => (
                  <tr key={order.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">
                      {order.external_order_id || order.id}
                      <span className="block text-[10px] text-slate-500 font-normal">
                        Placed: {new Date(order.order_date).toLocaleDateString()}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-medium text-pink-300">
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-slate-500 shrink-0" />
                        <span
                          className={
                            mobileQuery.trim()
                              ? 'bg-pink-950/80 text-pink-300 px-1.5 py-0.5 rounded border border-pink-700/50 font-semibold'
                              : ''
                          }
                        >
                          {order.account_phone || 'Unlinked'}
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 max-w-xs truncate text-slate-200 font-medium">
                      {order.product_name}
                      {order.sku && (
                        <span className="block font-mono text-[10px] text-slate-500">
                          SKU: {order.sku}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 font-mono font-bold text-slate-100">
                      ₹{order.order_amount.toFixed(2)}
                    </td>

                    <td className="py-3.5 px-4 font-mono">
                      {order.tracking_id ? (
                        <div>
                          <span className="font-semibold text-emerald-300 text-xs block truncate max-w-[150px]" title={order.tracking_id}>
                            {order.tracking_id}
                          </span>
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 font-sans font-medium mt-0.5">
                            Tracking ID Assigned
                          </span>
                        </div>
                      ) : (
                        <div>
                          <span className="text-slate-500 font-sans text-xs italic">Not Assigned</span>
                          <span className="block text-[10px] text-slate-600 font-sans">
                            Pending Courier
                          </span>
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      <Badge
                        variant={
                          order.delivery_status === 'delivered'
                            ? 'success'
                            : order.delivery_status === 'cancelled'
                            ? 'danger'
                            : order.delivery_status === 'returned' || order.delivery_status === 'rto'
                            ? 'warning'
                            : order.delivery_status === 'shipped' || order.delivery_status === 'out_for_delivery'
                            ? 'info'
                            : 'neutral'
                        }
                        size="sm"
                      >
                        {order.delivery_status.replace(/_/g, ' ')}
                      </Badge>
                      {order.delivery_status === 'delivered' && order.terminal_confirmed_at && (
                        <span className="block text-[10px] text-emerald-400/80 font-mono mt-0.5">
                          Delivered: {new Date(order.terminal_confirmed_at).toLocaleDateString()}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4">
                      {order.refund_status !== 'none' ? (
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
                      ) : (
                        <span className="text-slate-600 font-mono text-[11px]">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right pr-6">
                      <button
                        onClick={() => handleOpenStatusEdit(order)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                        title="Update Status"
                      >
                        <Edit className="w-3 h-3" />
                        <span>Update</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {sortedOrders.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-950/80 border-t border-slate-800 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span>
                Showing <strong className="text-slate-200">{(currentPage - 1) * pageSize + 1}</strong> to{' '}
                <strong className="text-slate-200">{Math.min(currentPage * pageSize, sortedOrders.length)}</strong> of{' '}
                <strong className="text-slate-200">{sortedOrders.length}</strong> orders
              </span>
              {(mobileQuery || searchQuery || statusFilter !== 'all') && (
                <span className="text-pink-400/80 text-[11px] font-mono">(filtered)</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Page Size Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400">Per page:</span>
                <select
                  value={pageSize}
                  onChange={e => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              {/* Page Navigation */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="Previous Page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-mono text-[11px] text-slate-300">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="Next Page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status Transition Modal */}
      <Modal
        isOpen={Boolean(editingOrder)}
        onClose={() => setEditingOrder(null)}
        title="Update Order Status"
        subtitle={`Order ${editingOrder?.external_order_id || editingOrder?.id}`}
        maxWidth="md"
      >
        <form onSubmit={handleSaveStatus} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Delivery Status
            </label>
            <select
              value={newDeliveryStatus}
              onChange={e => setNewDeliveryStatus(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 font-medium"
            >
              <option value="placed">Placed</option>
              <option value="confirmed">Confirmed</option>
              <option value="shipped">Shipped</option>
              <option value="out_for_delivery">Out For Delivery</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
              <option value="returned">Returned</option>
              <option value="rto">RTO (Return to Origin)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Refund Status
            </label>
            <select
              value={newRefundStatus}
              onChange={e => setNewRefundStatus(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 font-medium"
            >
              <option value="none">None</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="refunded">Refunded</option>
              <option value="failed">Failed</option>
              <option value="disputed">Disputed</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center justify-between">
              <span>Tracking ID / Shipment AWB</span>
              <span className={`text-[11px] font-normal ${editingTrackingId ? 'text-emerald-400' : 'text-slate-400'}`}>
                {editingTrackingId ? 'Tracking ID Assigned' : 'Not Assigned'}
              </span>
            </label>
            <input
              type="text"
              value={editingTrackingId}
              onChange={e => setEditingTrackingId(e.target.value)}
              placeholder="e.g. FMPC002910823, AWB-991204, SF10928192..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-pink-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Event Transition Note
            </label>
            <textarea
              value={statusNote}
              onChange={e => setStatusNote(e.target.value)}
              placeholder="e.g. Courier delivery confirmed by hub OTP verification..."
              rows={2}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setEditingOrder(null)}
              className="px-4 py-2 text-xs text-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold"
            >
              Save Status Transition
            </button>
          </div>
        </form>
      </Modal>

      {/* Create Order Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Order"
        subtitle="Manually link an order to an account mobile number"
        maxWidth="md"
      >
        <form onSubmit={handleCreateOrder} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Account Mobile Number
            </label>
            <input
              type="text"
              value={newAccountPhone}
              onChange={e => setNewAccountPhone(e.target.value)}
              placeholder="+91 90338 07401"
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Product Name
            </label>
            <input
              type="text"
              value={newProduct}
              onChange={e => setNewProduct(e.target.value)}
              placeholder="e.g. Traditional Anarkali Kurti Set"
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Amount (₹)
              </label>
              <input
                type="number"
                step="0.01"
                value={newAmount}
                onChange={e => setNewAmount(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                External Order ID
              </label>
              <input
                type="text"
                value={newExternalId}
                onChange={e => setNewExternalId(e.target.value)}
                placeholder="MSHO-ORD-2025-..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Tracking ID (Optional)</span>
              <span className={`text-[11px] font-normal ${newTrackingId.trim() ? 'text-emerald-400' : 'text-slate-500'}`}>
                {newTrackingId.trim() ? 'Tracking ID Assigned' : 'Leave blank if pending'}
              </span>
            </label>
            <input
              type="text"
              value={newTrackingId}
              onChange={e => setNewTrackingId(e.target.value)}
              placeholder="e.g. FMPC002910823, SF10928192 (optional)"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-100 placeholder-slate-600"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="px-4 py-2 text-xs text-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold"
            >
              Create Order
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
