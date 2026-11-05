import React, { useState, useEffect } from 'react';
import { AccountRecord } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { Trash2, RotateCcw, AlertTriangle, Search, CheckSquare } from 'lucide-react';

export const RecycleBinView: React.FC = () => {
  const { dataVersion, showToast, refreshData } = useApp();
  const { canPermanentDelete } = useAuth();

  const [archivedAccounts, setArchivedAccounts] = useState<AccountRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');

  // Confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    StorageService.getAccounts({
      onlyArchived: true,
      search,
      pageSize: 5000,
    }).then(res => {
      if (isMounted) {
        setArchivedAccounts(res.accounts);
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [search, dataVersion]);

  const handleRestore = async (id: string, phone: string) => {
    const count = await StorageService.restoreAccounts([id]);
    if (count > 0) {
      showToast(`Restored account ${phone}`, 'success', true);
      refreshData();
    }
  };

  const handleBulkRestore = async () => {
    const count = await StorageService.restoreAccounts(selectedIds);
    if (count > 0) {
      showToast(`Restored ${count} account(s)`, 'success', true);
      setSelectedIds([]);
      refreshData();
    }
  };

  const handleExecutePermanentDelete = async () => {
    if (!confirmDeleteId) return;
    const target = archivedAccounts.find(a => a.id === confirmDeleteId);
    await StorageService.permanentDeleteAccounts([confirmDeleteId]);
    showToast(`Permanently deleted ${target?.phone_display || 'account'}`, 'warning');
    setConfirmDeleteId(null);
    refreshData();
  };

  const handleExecuteBulkDelete = async () => {
    const count = await StorageService.permanentDeleteAccounts(selectedIds);
    showToast(`Permanently purged ${count} account(s)`, 'warning');
    setSelectedIds([]);
    setConfirmBulkDelete(false);
    refreshData();
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === archivedAccounts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(archivedAccounts.map(a => a.id));
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-bold text-slate-100">Recycle Bin & Account Recovery</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Archived accounts are retained here safely. Restore accounts to the active roster or perform authorized permanent purging.
          </p>
        </div>

        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={handleBulkRestore}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore Selected ({selectedIds.length})</span>
            </button>

            {canPermanentDelete && (
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Permanently</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Search Header */}
      <div className="flex items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search archived mobile numbers..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono"
          />
        </div>

        <span className="text-xs text-slate-400">
          {archivedAccounts.length} archived record(s)
        </span>
      </div>

      {/* Recycle Bin Table (Shows mobile number and actions) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-4 w-12 text-center">
                  <input
                    type="checkbox"
                    checked={archivedAccounts.length > 0 && selectedIds.length === archivedAccounts.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-700 text-pink-600 focus:ring-pink-500 bg-slate-900 cursor-pointer"
                  />
                </th>
                <th className="py-3.5 px-4">Mobile Number</th>
                <th className="py-3.5 px-4">Archived Timestamp</th>
                <th className="py-3.5 px-4 text-right pr-6">Recovery Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    Loading recycle bin...
                  </td>
                </tr>
              ) : archivedAccounts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    Recycle bin is empty. No archived records.
                  </td>
                </tr>
              ) : (
                archivedAccounts.map(account => {
                  const isSelected = selectedIds.includes(account.id);
                  return (
                    <tr key={account.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            if (isSelected) {
                              setSelectedIds(selectedIds.filter(i => i !== account.id));
                            } else {
                              setSelectedIds([...selectedIds, account.id]);
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-700 text-pink-600 focus:ring-pink-500 bg-slate-900 cursor-pointer"
                        />
                      </td>

                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">
                        {account.phone_display}
                      </td>

                      <td className="py-3.5 px-4 font-mono text-slate-400">
                        {account.archived_at
                          ? new Date(account.archived_at).toLocaleString()
                          : new Date(account.updated_at).toLocaleString()}
                      </td>

                      <td className="py-3.5 px-4 text-right pr-6">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleRestore(account.id, account.phone_display)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 rounded text-xs font-medium transition-colors cursor-pointer"
                            title="Restore Account"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Restore</span>
                          </button>

                          {canPermanentDelete && (
                            <button
                              onClick={() => setConfirmDeleteId(account.id)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                              title="Delete Permanently"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
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
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={Boolean(confirmDeleteId)}
        title="Permanently Delete Account"
        message="This will permanently delete the account from the database. This action CANNOT be recovered or undone."
        confirmLabel="Purge Permanently"
        isDestructive
        onConfirm={handleExecutePermanentDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmDialog
        isOpen={confirmBulkDelete}
        title={`Permanently Purge ${selectedIds.length} Accounts`}
        message={`Are you sure you want to permanently delete all ${selectedIds.length} selected accounts?`}
        confirmLabel="Purge All Selected"
        isDestructive
        onConfirm={handleExecuteBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
};
