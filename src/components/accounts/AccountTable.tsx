import React, { useState, useEffect, useMemo } from 'react';
import { AccountRecord } from '../../types';
import { StorageService } from '../../lib/storageAdapter';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { downloadSingleAccountJson, sanitizeAccountJsonForSafeCopy } from '../../lib/exportUtils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import {
  Eye,
  Copy,
  Download,
  ShoppingBag,
  MoreVertical,
  Archive,
  Trash2,
  Edit,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Send,
  MapPin,
  MapPinOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import {
  refreshSingleAccountSession,
  isAccountRefreshing,
} from '../../lib/accountRefreshService';
import { TelegramBotModal } from '../telegram/TelegramBotModal';
import { getTokenHealth, TokenHealthStatus } from '../../lib/tokenHealth';
import { getAccountAssignedAddress } from '../../lib/addressStorage';

interface AccountTableProps {
  onViewAccount: (account: AccountRecord) => void;
  onEditAccount: (account: AccountRecord) => void;
  onViewOrders: (account: AccountRecord) => void;
  selectedIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  filterStatus?: string;
  tokenHealthFilter?: string;
}

export const AccountTable: React.FC<AccountTableProps> = ({
  onViewAccount,
  onEditAccount,
  onViewOrders,
  selectedIds,
  onSelectionChange,
  filterStatus,
  tokenHealthFilter,
}) => {
  const { dataVersion, showToast, accountSearchQuery, setAccountSearchQuery, refreshData } = useApp();
  const { canArchive, canPermanentDelete, canViewSensitiveTokens } = useAuth();

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const pageSize = 20;

  // Confirmation dialog state
  const [confirmArchiveAccount, setConfirmArchiveAccount] = useState<AccountRecord | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState<AccountRecord | null>(null);
  const [telegramSyncAccount, setTelegramSyncAccount] = useState<AccountRecord | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Per-account refresh state tracking
  const [refreshStates, setRefreshStates] = useState<
    Record<
      string,
      {
        isRefreshing: boolean;
        status?: 'Success' | 'Failed' | 'Re-login Required';
        message?: string;
      }
    >
  >({});

  // Single-account JSON refresh handler
  const handleRefreshJson = async (account: AccountRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const accountId = account.id;

    if (refreshStates[accountId]?.isRefreshing || isAccountRefreshing(accountId)) {
      return;
    }

    setRefreshStates(prev => ({
      ...prev,
      [accountId]: { isRefreshing: true },
    }));

    try {
      const result = await refreshSingleAccountSession(account);

      setRefreshStates(prev => ({
        ...prev,
        [accountId]: {
          isRefreshing: false,
          status: result.display_status,
          message: result.message,
        },
      }));

      if (result.success && result.refreshed_json) {
        showToast(
          `Refreshed session for ${account.phone_display}: ${result.message}`,
          'success'
        );
        setAccounts(prevAccounts =>
          prevAccounts.map(acc =>
            acc.id === accountId
              ? {
                  ...acc,
                  account_json: result.refreshed_json!,
                  updated_at: new Date().toISOString(),
                }
              : acc
          )
        );
        refreshData();
      } else {
        if (result.status === 'REQUIRES_REAUTH' || result.status === 'EXPIRED') {
          showToast(
            `Re-login required for ${account.phone_display}: ${result.message}`,
            'warning'
          );
        } else {
          showToast(
            `Refresh failed for ${account.phone_display}: ${result.message}`,
            'error'
          );
        }
      }
    } catch (err: any) {
      setRefreshStates(prev => ({
        ...prev,
        [accountId]: {
          isRefreshing: false,
          status: 'Failed',
          message: err?.message || 'Unexpected refresh error',
        },
      }));
      showToast(
        `Failed to refresh ${account.phone_display}: ${err?.message || 'Error occurred'}`,
        'error'
      );
    }
  };

  // Fetch accounts
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    StorageService.getAccounts({
      search: accountSearchQuery,
      includeArchived: false,
      status: filterStatus,
      page,
      pageSize,
      sortField: 'created_at',
      sortAsc: false,
    }).then(res => {
      if (isMounted) {
        setAccounts(res.accounts);
        setTotalCount(res.total);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [page, accountSearchQuery, filterStatus, dataVersion]);

  // Filter accounts by Token Health Sentinel if specified
  const displayedAccounts = useMemo(() => {
    if (!tokenHealthFilter || tokenHealthFilter === 'all') return accounts;
    return accounts.filter(a => {
      const h = getTokenHealth(a.account_json);
      return h.status === tokenHealthFilter;
    });
  }, [accounts, tokenHealthFilter]);

  // Handle Select All on current page
  const allCurrentPageSelected = useMemo(() => {
    if (displayedAccounts.length === 0) return false;
    return displayedAccounts.every(a => selectedIds.includes(a.id));
  }, [displayedAccounts, selectedIds]);

  const toggleSelectAll = () => {
    if (allCurrentPageSelected) {
      const pageIds = new Set(displayedAccounts.map(a => a.id));
      onSelectionChange(selectedIds.filter(id => !pageIds.has(id)));
    } else {
      const newSelected = new Set(selectedIds);
      displayedAccounts.forEach(a => newSelected.add(a.id));
      onSelectionChange(Array.from(newSelected));
    }
  };

  const toggleSelectOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter(i => i !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  // Copy JSON handler
  const handleCopyJson = async (account: AccountRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const payload = canViewSensitiveTokens
        ? account.account_json
        : sanitizeAccountJsonForSafeCopy(account.account_json);
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      showToast(
        canViewSensitiveTokens
          ? `Complete JSON copied for ${account.phone_display}`
          : `Safe JSON copied (sensitive tokens masked) for ${account.phone_display}`,
        'success'
      );
    } catch {
      showToast('Failed to copy JSON to clipboard', 'error');
    }
  };

  // Download JSON handler
  const handleDownloadJson = (account: AccountRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      downloadSingleAccountJson(account, canViewSensitiveTokens);
      showToast(`Downloaded account_${account.phone_normalized.replace(/[^0-9]/g, '')}.json`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Download failed', 'error');
    }
  };

  // Archive execution
  const executeArchive = async () => {
    if (!confirmArchiveAccount) return;
    const count = await StorageService.archiveAccounts([confirmArchiveAccount.id]);
    if (count > 0) {
      showToast(`Archived account ${confirmArchiveAccount.phone_display}`, 'info', true);
      refreshData();
    }
    setConfirmArchiveAccount(null);
  };

  // Delete execution
  const executePermanentDelete = async () => {
    if (!confirmDeleteAccount) return;
    const count = await StorageService.permanentDeleteAccounts([confirmDeleteAccount.id]);
    if (count > 0) {
      showToast(`Permanently deleted account ${confirmDeleteAccount.phone_display}`, 'warning');
      refreshData();
    }
    setConfirmDeleteAccount(null);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex flex-col gap-4">
      {/* Search Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={accountSearchQuery}
            onChange={e => {
              setAccountSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search mobile number (e.g. 9033807401 or +91)..."
            className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500"
          />
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-slate-400">
          <span>
            Showing <strong className="text-slate-200">{accounts.length}</strong> of{' '}
            <strong className="text-slate-200">{totalCount}</strong> accounts
          </span>
          {filterStatus && (
            <span className="px-2 py-0.5 rounded bg-pink-950/60 text-pink-300 border border-pink-800 text-[11px] font-mono">
              Status: {filterStatus}
            </span>
          )}
        </div>
      </div>

      {/* MANDATORY MAIN ACCOUNT TABLE:
          Exact structure:
          | Select | Mobile Number | Actions |
          Display ONLY the mobile number. No other columns!
      */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="main-account-table">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={allCurrentPageSelected}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-700 text-pink-600 focus:ring-pink-500 bg-slate-900 cursor-pointer"
                    aria-label="Select all accounts on page"
                  />
                </th>
                <th className="py-3.5 px-4">Mobile Number</th>
                <th className="py-3.5 px-4 text-right pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-slate-400">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                      <span>Loading accounts...</span>
                    </div>
                  </td>
                </tr>
              ) : displayedAccounts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ShieldAlert className="w-8 h-8 text-slate-600" />
                      <p className="text-base font-medium text-slate-300">No matching account records</p>
                      <p className="text-xs text-slate-500 max-w-sm">
                        {tokenHealthFilter && tokenHealthFilter !== 'all'
                          ? `No accounts found with token health status "${tokenHealthFilter}".`
                          : accountSearchQuery
                          ? `No mobile number matching "${accountSearchQuery}". Try a different query.`
                          : 'Import JSON or TXT accounts from the Import Center to begin.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                displayedAccounts.map(account => {
                  const isSelected = selectedIds.includes(account.id);
                  const isDropdownOpen = openDropdownId === account.id;

                  return (
                    <tr
                      key={account.id}
                      className={`transition-colors hover:bg-slate-800/50 ${
                        isSelected ? 'bg-pink-950/20' : ''
                      }`}
                    >
                      {/* 1. SELECT (Checkbox) */}
                      <td className="py-3.5 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectOne(account.id)}
                          className="w-4 h-4 rounded border-slate-700 text-pink-600 focus:ring-pink-500 bg-slate-900 cursor-pointer"
                          aria-label={`Select account ${account.phone_display}`}
                        />
                      </td>

                      {/* 2. MOBILE NUMBER & METADATA (Strict 3-column table requirement) */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center flex-wrap gap-2">
                            <button
                              onClick={() => onViewAccount(account)}
                              className="font-mono text-slate-100 font-semibold hover:text-pink-400 text-sm sm:text-base tracking-wide transition-colors cursor-pointer text-left"
                              title="Click to view full account details"
                            >
                              {account.phone_display}
                            </button>

                            {/* Token Health Sentinel Badge */}
                            {(() => {
                              const health = getTokenHealth(account.account_json);
                              return (
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold border ${health.badgeClass}`}
                                  title={health.expiresAt ? `Token Expiry: ${new Date(health.expiresAt).toLocaleString()}` : health.label}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${
                                    health.status === 'active'
                                      ? 'bg-emerald-400'
                                      : health.status === 'expiring_soon'
                                      ? 'bg-amber-400 animate-pulse'
                                      : health.status === 'expired'
                                      ? 'bg-rose-400'
                                      : 'bg-slate-400'
                                  }`} />
                                  <span>{health.label}</span>
                                </span>
                              );
                            })()}

                            {/* Record Status Badges */}
                            {account.record_status === 'sold' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-950/90 text-purple-300 border border-purple-700/80 shadow-sm">
                                Sold (Excluded)
                              </span>
                            )}
                            {account.record_status === 'review_required' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/80 text-amber-300 border border-amber-800">
                                Review Required
                              </span>
                            )}
                            {account.record_status === 'conflict' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/80 text-rose-300 border border-rose-800">
                                Conflict
                              </span>
                            )}
                            {account.record_status === 'invalid' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-950/80 text-red-300 border border-red-800">
                                Invalid
                              </span>
                            )}
                            {account.record_status === 'archived' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                                Archived
                              </span>
                            )}

                            {/* Assigned Address Distinction (Requirement 4) */}
                            {(() => {
                              const addr = getAccountAssignedAddress(account);
                              if (addr) {
                                return (
                                  <span
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/60"
                                    title={`Assigned Address: ${addr.name}, ${addr.address_line_1}, ${addr.city} - ${addr.pin} (+91 ${addr.mobile})`}
                                  >
                                    <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <span className="truncate max-w-[130px]">{addr.city} ({addr.pin})</span>
                                  </span>
                                );
                              }
                              return (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-slate-500 bg-slate-900/60 border border-slate-800"
                                  title="No delivery address assigned to this account"
                                >
                                  <MapPinOff className="w-3 h-3 text-slate-600 shrink-0" />
                                  <span>No Address</span>
                                </span>
                              );
                            })()}

                            {/* Account-level Refresh JSON Button & Feedback Status */}
                            {(() => {
                              const state = refreshStates[account.id];
                              const isRefreshing = state?.isRefreshing || false;
                              const status = state?.status;
                              const message = state?.message;

                              if (isRefreshing) {
                                return (
                                  <span
                                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-700/80 shadow-sm animate-pulse"
                                    aria-live="polite"
                                  >
                                    <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />
                                    <span>Refreshing…</span>
                                  </span>
                                );
                              }

                              return (
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={e => handleRefreshJson(account, e)}
                                    disabled={isRefreshing}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Refresh only this account's JSON session tokens"
                                    aria-label={`Refresh JSON for account ${account.phone_display}`}
                                  >
                                    <RefreshCw className="w-3 h-3 text-cyan-400" />
                                    <span>Refresh JSON</span>
                                  </button>

                                  {status === 'Success' && (
                                    <span
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/90 text-emerald-300 border border-emerald-600 shadow-sm"
                                      title={message || 'Verified session saved'}
                                    >
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                      <span>Success</span>
                                    </span>
                                  )}

                                  {status === 'Re-login Required' && (
                                    <span
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/90 text-amber-300 border border-amber-600 shadow-sm"
                                      title={message || 'Re-authentication or OTP required'}
                                    >
                                      <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                                      <span>Re-login Required</span>
                                    </span>
                                  )}

                                  {status === 'Failed' && (
                                    <span
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-950/90 text-rose-300 border border-rose-600 shadow-sm"
                                      title={message || 'Refresh operation failed'}
                                    >
                                      <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                                      <span>Failed</span>
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </div>

                          {/* Account Tags & Notes preview */}
                          {((account.tags && account.tags.length > 0) || account.notes) && (
                            <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                              {account.tags && account.tags.map((t, tidx) => (
                                <span
                                  key={tidx}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-pink-950/40 text-pink-300 border border-pink-900/60"
                                >
                                  #{t}
                                </span>
                              ))}
                              {account.notes && (
                                <span
                                  className="text-[11px] text-slate-400 italic max-w-xs truncate"
                                  title={account.notes}
                                >
                                  “{account.notes}”
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 3. ACTIONS */}
                      <td className="py-3.5 px-4 text-right pr-6">
                        {/* Desktop Inline Actions: View · Copy JSON · Download JSON · Orders · Archive */}
                        <div className="hidden md:flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onViewAccount(account)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                            title="View Account Details"
                          >
                            <Eye className="w-3.5 h-3.5 text-pink-400" />
                            <span>View</span>
                          </button>

                          <button
                            type="button"
                            onClick={e => handleRefreshJson(account, e)}
                            disabled={refreshStates[account.id]?.isRefreshing}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Refresh JSON Session"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${refreshStates[account.id]?.isRefreshing ? 'animate-spin' : ''}`} />
                            <span>{refreshStates[account.id]?.isRefreshing ? 'Refreshing…' : 'Refresh JSON'}</span>
                          </button>

                          <button
                            onClick={e => handleCopyJson(account, e)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                            title="Copy Account JSON"
                          >
                            <Copy className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Copy JSON</span>
                          </button>

                          <button
                            onClick={e => handleDownloadJson(account, e)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                            title="Download Standalone .json"
                          >
                            <Download className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Download JSON</span>
                          </button>

                          <button
                            onClick={() => onViewOrders(account)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                            title="View Orders"
                          >
                            <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                            <span>Orders</span>
                          </button>

                          <button
                            onClick={() => setTelegramSyncAccount(account)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors cursor-pointer"
                            title="Sync via @primes_meesho_bot"
                          >
                            <Send className="w-3.5 h-3.5 text-pink-400" />
                            <span>Bot Sync</span>
                          </button>

                          <button
                            onClick={() => onEditAccount(account)}
                            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                            title="Edit Tags / Metadata"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>

                          {canArchive && (
                            <button
                              onClick={() => setConfirmArchiveAccount(account)}
                              className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                              title="Archive Account"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {canPermanentDelete && (
                            <button
                              onClick={() => setConfirmDeleteAccount(account)}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                              title="Delete Account"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Mobile Dropdown Menu for Small Screens */}
                        <div className="relative md:hidden inline-block text-left">
                          <button
                            onClick={() =>
                              setOpenDropdownId(isDropdownOpen ? null : account.id)
                            }
                            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                            aria-label="Account actions menu"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {isDropdownOpen && (
                            <div className="absolute right-0 mt-1 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-20 py-1 text-xs text-slate-200">
                              <button
                                onClick={() => {
                                  setOpenDropdownId(null);
                                  onViewAccount(account);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2"
                              >
                                <Eye className="w-3.5 h-3.5 text-pink-400" />
                                <span>View Account</span>
                              </button>

                              <button
                                type="button"
                                disabled={refreshStates[account.id]?.isRefreshing}
                                onClick={e => {
                                  setOpenDropdownId(null);
                                  handleRefreshJson(account, e);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 text-cyan-400 disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${refreshStates[account.id]?.isRefreshing ? 'animate-spin' : ''}`} />
                                <span>{refreshStates[account.id]?.isRefreshing ? 'Refreshing…' : 'Refresh JSON'}</span>
                              </button>

                              <button
                                onClick={e => {
                                  setOpenDropdownId(null);
                                  handleCopyJson(account, e);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2"
                              >
                                <Copy className="w-3.5 h-3.5 text-cyan-400" />
                                <span>Copy JSON</span>
                              </button>

                              <button
                                onClick={e => {
                                  setOpenDropdownId(null);
                                  handleDownloadJson(account, e);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2"
                              >
                                <Download className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Download JSON</span>
                              </button>

                              <button
                                onClick={() => {
                                  setOpenDropdownId(null);
                                  onViewOrders(account);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2"
                              >
                                <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                                <span>View Orders</span>
                              </button>

                              <button
                                onClick={() => {
                                  setOpenDropdownId(null);
                                  setTelegramSyncAccount(account);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2 text-pink-400"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Bot Sync (@primes_meesho_bot)</span>
                              </button>

                              <button
                                onClick={() => {
                                  setOpenDropdownId(null);
                                  onEditAccount(account);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-center gap-2"
                              >
                                <Edit className="w-3.5 h-3.5 text-slate-400" />
                                <span>Edit Metadata</span>
                              </button>

                              {canArchive && (
                                <button
                                  onClick={() => {
                                    setOpenDropdownId(null);
                                    setConfirmArchiveAccount(account);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-800 text-amber-400 flex items-center gap-2"
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                  <span>Archive</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Server-side / State Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-t border-slate-800 text-xs text-slate-400">
            <div>
              Page <span className="text-slate-200 font-semibold">{page}</span> of{' '}
              <span className="text-slate-200 font-semibold">{totalPages}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={Boolean(confirmArchiveAccount)}
        title="Archive Account"
        message={`Are you sure you want to archive account ${confirmArchiveAccount?.phone_display}? It will be removed from the active view into the Recycle Bin.`}
        confirmLabel="Archive Record"
        onConfirm={executeArchive}
        onCancel={() => setConfirmArchiveAccount(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(confirmDeleteAccount)}
        title="Permanently Delete Account"
        message={`Are you sure you want to permanently delete account ${confirmDeleteAccount?.phone_display}? This action CANNOT be undone.`}
        confirmLabel="Delete Permanently"
        isDestructive
        onConfirm={executePermanentDelete}
        onCancel={() => setConfirmDeleteAccount(null)}
      />

      {/* Telegram Bot Integration Modal */}
      <TelegramBotModal
        isOpen={Boolean(telegramSyncAccount)}
        onClose={() => setTelegramSyncAccount(null)}
        account={telegramSyncAccount}
        onSuccess={() => {
          setTelegramSyncAccount(null);
          refreshData();
        }}
      />
    </div>
  );
};
