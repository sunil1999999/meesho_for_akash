import React, { useState, useEffect } from 'react';
import { AccountRecord } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { AccountTable } from '../components/accounts/AccountTable';
import { AccountDetailDrawer } from '../components/accounts/AccountDetailDrawer';
import { AccountEditModal } from '../components/accounts/AccountEditModal';
import { BulkOperationsBar } from '../components/accounts/BulkOperationsBar';
import { Users, Filter, RefreshCw, ShieldCheck } from 'lucide-react';
import { CheckoutApi } from '../lib/checkoutApi';

export const AccountsView: React.FC = () => {
  const { setActiveTab, dataVersion, showToast, refreshData } = useApp();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeAccount, setActiveAccount] = useState<AccountRecord | null>(null);
  const [editingAccount, setEditingAccount] = useState<AccountRecord | null>(null);
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [tokenHealthFilter, setTokenHealthFilter] = useState<'all' | 'active' | 'expiring_soon' | 'expired'>('all');
  const [isRefreshingSessions, setIsRefreshingSessions] = useState(false);
  const [allAccounts, setAllAccounts] = useState<AccountRecord[]>([]);

  // Keep a reference of accounts for bulk operations
  useEffect(() => {
    StorageService.getAccounts({ includeArchived: false, pageSize: 5000 }).then(res => {
      setAllAccounts(res.accounts);
    });
  }, [dataVersion]);

  const handleViewOrders = (account: AccountRecord) => {
    setActiveTab('orders');
  };

  const handleBulkRefreshSessions = async () => {
    setIsRefreshingSessions(true);
    try {
      showToast('Refreshing account sessions in background...', 'info');
      const res = await CheckoutApi.bulkRefreshSessions();
      showToast(
        `Session Refresh complete: ${res.refreshed} updated, ${res.failed} failed out of ${res.total_checked} accounts`,
        'success'
      );
      refreshData();
    } catch (err: any) {
      showToast(err?.message || 'Bulk session refresh failed', 'error');
    } finally {
      setIsRefreshingSessions(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Bulk Refresh Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">Authorized Accounts</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time token expiry sentinel, normalized mobile view, and safe authorized operations.
          </p>
        </div>

        {/* 1-Click Bulk Refresh Sessions Button */}
        <button
          type="button"
          disabled={isRefreshingSessions}
          onClick={handleBulkRefreshSessions}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer shadow-sm self-start sm:self-auto"
          title="Refreshes all account authentication sessions before ordering"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshingSessions ? 'animate-spin' : ''}`} />
          <span>{isRefreshingSessions ? 'Refreshing Sessions...' : 'Bulk Refresh Sessions'}</span>
        </button>
      </div>

      {/* Dual Filter Bars: Token Health Sentinel & Record Status */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 p-3 rounded-2xl">
        {/* Token Expiry Sentinel Filter Pills */}
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="text-[11px] font-semibold text-slate-400 mr-1 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Token Sentinel:
          </span>
          <button
            onClick={() => setTokenHealthFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              tokenHealthFilter === 'all'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
            }`}
          >
            All Tokens
          </button>
          <button
            onClick={() => setTokenHealthFilter('active')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              tokenHealthFilter === 'active'
                ? 'bg-emerald-700 text-white shadow-sm'
                : 'text-emerald-300 hover:text-emerald-200 bg-emerald-950/40 border border-emerald-800/40'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Active (&gt; 24h)
          </button>
          <button
            onClick={() => setTokenHealthFilter('expiring_soon')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              tokenHealthFilter === 'expiring_soon'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'text-amber-300 hover:text-amber-200 bg-amber-950/40 border border-amber-800/40'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Expiring Soon (&lt; 24h)
          </button>
          <button
            onClick={() => setTokenHealthFilter('expired')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              tokenHealthFilter === 'expired'
                ? 'bg-rose-700 text-white shadow-sm'
                : 'text-rose-300 hover:text-rose-200 bg-rose-950/40 border border-rose-800/40'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            Expired / Needs Re-Auth
          </button>
        </div>

        {/* Record Status Filter Pills */}
        <div className="flex items-center flex-wrap gap-1.5 border-t lg:border-t-0 pt-2 lg:pt-0 border-slate-800/80">
          <span className="text-[11px] font-semibold text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-pink-400" /> Status:
          </span>
          <button
            onClick={() => setFilterStatus(undefined)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterStatus === undefined
                ? 'bg-pink-700 text-white'
                : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilterStatus('active')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterStatus === 'active'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilterStatus('sold')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterStatus === 'sold'
                ? 'bg-purple-700 text-white'
                : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
            }`}
          >
            Sold (Excluded)
          </button>
          <button
            onClick={() => setFilterStatus('review_required')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterStatus === 'review_required'
                ? 'bg-amber-700 text-white'
                : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
            }`}
          >
            Review
          </button>
          <button
            onClick={() => setFilterStatus('conflict')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterStatus === 'conflict'
                ? 'bg-rose-700 text-white'
                : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
            }`}
          >
            Conflicts
          </button>
          <button
            onClick={() => setFilterStatus('invalid')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterStatus === 'invalid'
                ? 'bg-red-700 text-white'
                : 'text-slate-400 hover:text-slate-200 bg-slate-800/60'
            }`}
          >
            Invalid
          </button>
        </div>
      </div>

      {/* Main Account Table (STRICT REQUIREMENT: Checkbox | Mobile Number | Actions ONLY) */}
      <AccountTable
        onViewAccount={acc => setActiveAccount(acc)}
        onEditAccount={acc => setEditingAccount(acc)}
        onViewOrders={handleViewOrders}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        filterStatus={filterStatus}
        tokenHealthFilter={tokenHealthFilter}
      />

      {/* Detail Drawer (Authorized JSON Viewer & Metadata) */}
      <AccountDetailDrawer
        account={activeAccount}
        onClose={() => setActiveAccount(null)}
        onViewOrders={handleViewOrders}
      />

      {/* Edit Metadata Modal */}
      <AccountEditModal
        account={editingAccount}
        isOpen={Boolean(editingAccount)}
        onClose={() => setEditingAccount(null)}
      />

      {/* Bulk Operations Bar */}
      <BulkOperationsBar
        selectedIds={selectedIds}
        onClearSelection={() => setSelectedIds([])}
        accounts={allAccounts}
      />
    </div>
  );
};
