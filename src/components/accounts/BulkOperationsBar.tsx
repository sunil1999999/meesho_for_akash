import React, { useState } from 'react';
import { AccountRecord } from '../../types';
import { StorageService } from '../../lib/storageAdapter';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import {
  exportAccountsCombinedJson,
  exportAccountsCsv,
  downloadAllIndividualFiles,
} from '../../lib/exportUtils';
import {
  Archive,
  Tag,
  Download,
  ShieldCheck,
  CheckSquare,
  X,
  FileSpreadsheet,
  FileJson,
} from 'lucide-react';

interface BulkOperationsBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
  accounts: AccountRecord[];
}

export const BulkOperationsBar: React.FC<BulkOperationsBarProps> = ({
  selectedIds,
  onClearSelection,
  accounts,
}) => {
  const { showToast, refreshData, setActiveTab } = useApp();
  const { canArchive, canPerformBulkEdit } = useAuth();

  const [activeModal, setActiveModal] = useState<
    'archive' | 'status' | 'tags' | 'export' | null
  >(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('active');
  const [bulkTag, setBulkTag] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  if (selectedIds.length === 0) return null;

  // Selected accounts and their mobile numbers
  const selectedAccounts = accounts.filter(a => selectedIds.includes(a.id));
  const selectedPhones = selectedAccounts.map(a => a.phone_display);

  // 1. Bulk Archive
  const handleBulkArchive = async () => {
    setIsProcessing(true);
    try {
      const count = await StorageService.archiveAccounts(selectedIds);
      showToast(`Successfully archived ${count} account(s)`, 'success', true);
      refreshData();
      onClearSelection();
      setActiveModal(null);
    } catch {
      showToast('Bulk archive failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Bulk Status Change
  const handleBulkStatus = async () => {
    setIsProcessing(true);
    try {
      let updatedCount = 0;
      for (const id of selectedIds) {
        await StorageService.updateAccount(id, { record_status: selectedStatus as any });
        updatedCount++;
      }
      showToast(`Updated status to '${selectedStatus}' for ${updatedCount} account(s)`, 'success', true);
      refreshData();
      onClearSelection();
      setActiveModal(null);
    } catch (err: any) {
      showToast(err?.message || 'Bulk status update failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Bulk Add Tag
  const handleBulkAddTag = async () => {
    if (!bulkTag.trim()) return;
    setIsProcessing(true);
    try {
      const tag = bulkTag.trim().toLowerCase();
      let count = 0;
      for (const acc of selectedAccounts) {
        const currentTags = acc.tags || [];
        if (!currentTags.includes(tag)) {
          await StorageService.updateAccount(acc.id, {
            tags: [...currentTags, tag],
          });
          count++;
        }
      }
      showToast(`Added tag '${tag}' to ${count} account(s)`, 'success', true);
      refreshData();
      onClearSelection();
      setActiveModal(null);
      setBulkTag('');
    } catch {
      showToast('Failed to apply bulk tag', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Bulk Export
  const handleExportJson = () => {
    exportAccountsCombinedJson(selectedAccounts, false);
    showToast(`Exported ${selectedAccounts.length} accounts to combined JSON`, 'success');
    setActiveModal(null);
  };

  const handleExportCsv = () => {
    exportAccountsCsv(selectedAccounts);
    showToast(`Exported ${selectedAccounts.length} accounts to CSV`, 'success');
    setActiveModal(null);
  };

  const handleDownloadAllIndividual = async () => {
    setActiveModal(null);
    showToast(`Starting sequential downloads for ${selectedAccounts.length} individual JSON files (NO ARCHIVE)...`, 'info');
    await downloadAllIndividualFiles(selectedAccounts, (done, total) => {
      if (done === total) {
        showToast(`Downloaded all ${total} individual files successfully`, 'success');
      }
    });
  };

  return (
    <>
      {/* Floating Bulk Operations Toolbar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-md px-4 py-3 flex flex-wrap items-center gap-3 animate-in slide-in-from-bottom duration-200">
        <div className="flex items-center gap-2 pr-3 border-r border-slate-700">
          <CheckSquare className="w-4 h-4 text-pink-400" />
          <span className="text-xs font-semibold text-slate-200">
            {selectedIds.length} <span className="hidden sm:inline">account(s)</span> selected
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canArchive && (
            <button
              onClick={() => setActiveModal('archive')}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Archive</span>
            </button>
          )}

          {canPerformBulkEdit && (
            <>
              <button
                onClick={() => setActiveModal('status')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Set Status</span>
              </button>

              <button
                onClick={() => setActiveModal('tags')}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Tag className="w-3.5 h-3.5 text-cyan-400" />
                <span>Add Tag</span>
              </button>
            </>
          )}

          <button
            onClick={() => setActiveModal('export')}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export</span>
          </button>

          <button
            onClick={() => setActiveTab('data_quality')}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer hidden md:flex"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-pink-400" />
            <span>Data Quality</span>
          </button>
        </div>

        <button
          onClick={onClearSelection}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
          title="Deselect all"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 1. Bulk Archive Modal */}
      <Modal
        isOpen={activeModal === 'archive'}
        onClose={() => setActiveModal(null)}
        title={`Archive ${selectedIds.length} Accounts`}
        subtitle="Confirm archiving selected accounts identified by mobile number"
        maxWidth="md"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-300">
            The following mobile numbers will be moved to the Recycle Bin:
          </p>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 max-h-40 overflow-y-auto flex flex-wrap gap-1.5">
            {selectedPhones.map((phone, i) => (
              <span key={i} className="px-2 py-0.5 font-mono text-xs bg-slate-800 text-slate-200 rounded">
                {phone}
              </span>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              onClick={() => setActiveModal(null)}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkArchive}
              disabled={isProcessing}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold"
            >
              {isProcessing ? 'Archiving...' : 'Confirm Bulk Archive'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 2. Bulk Status Modal */}
      <Modal
        isOpen={activeModal === 'status'}
        onClose={() => setActiveModal(null)}
        title={`Update Status for ${selectedIds.length} Accounts`}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Select Target Record Status:
            </label>
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-sm text-slate-100"
            >
              <option value="active">Active</option>
              <option value="sold">Sold (Permanently Excluded from Polling)</option>
              <option value="review_required">Review Required</option>
              <option value="conflict">Identity Conflict</option>
              <option value="invalid">Invalid</option>
              <option value="archived">Archived</option>
            </select>
            {selectedStatus === 'sold' && (
              <p className="text-xs text-purple-300 mt-2">
                Accounts will be permanently excluded from polling cycles and hidden from Direct Checkout & Pay.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button onClick={() => setActiveModal(null)} className="px-4 py-2 text-xs text-slate-400">
              Cancel
            </button>
            <button
              onClick={handleBulkStatus}
              disabled={isProcessing}
              className="px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold"
            >
              {isProcessing ? 'Updating...' : 'Apply Status'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 3. Bulk Tag Modal */}
      <Modal
        isOpen={activeModal === 'tags'}
        onClose={() => setActiveModal(null)}
        title={`Add Tag to ${selectedIds.length} Accounts`}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Tag Name:
            </label>
            <input
              type="text"
              value={bulkTag}
              onChange={e => setBulkTag(e.target.value)}
              placeholder="e.g. promotional_campaign_2025"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-100"
            />
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button onClick={() => setActiveModal(null)} className="px-4 py-2 text-xs text-slate-400">
              Cancel
            </button>
            <button
              onClick={handleBulkAddTag}
              disabled={isProcessing || !bulkTag.trim()}
              className="px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold"
            >
              {isProcessing ? 'Applying...' : 'Apply Tag'}
            </button>
          </div>
        </div>
      </Modal>

      {/* 4. Bulk Export Options Modal */}
      <Modal
        isOpen={activeModal === 'export'}
        onClose={() => setActiveModal(null)}
        title={`Export ${selectedIds.length} Selected Accounts`}
        subtitle="Download as combined data file or individual JSON files (strictly NO archives)"
        maxWidth="md"
      >
        <div className="space-y-3">
          <button
            onClick={handleExportJson}
            className="w-full p-3 bg-slate-950 hover:bg-slate-800/80 border border-slate-800 rounded-lg flex items-center justify-between text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <FileJson className="w-5 h-5 text-pink-400" />
              <div>
                <p className="text-xs font-semibold text-slate-200">Combined JSON Array</p>
                <p className="text-[11px] text-slate-400">Single .json data file containing all accounts</p>
              </div>
            </div>
            <Download className="w-4 h-4 text-slate-400" />
          </button>

          <button
            onClick={handleExportCsv}
            className="w-full p-3 bg-slate-950 hover:bg-slate-800/80 border border-slate-800 rounded-lg flex items-center justify-between text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="text-xs font-semibold text-slate-200">Metadata CSV</p>
                <p className="text-[11px] text-slate-400">Tabular report of phones, tags, and statuses</p>
              </div>
            </div>
            <Download className="w-4 h-4 text-slate-400" />
          </button>

          <button
            onClick={handleDownloadAllIndividual}
            className="w-full p-3 bg-slate-950 hover:bg-slate-800/80 border border-slate-800 rounded-lg flex items-center justify-between text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-cyan-400" />
              <div>
                <p className="text-xs font-semibold text-slate-200">Download All Individual Files</p>
                <p className="text-[11px] text-slate-400">
                  Separate standalone .json files (Never zipped or archived)
                </p>
              </div>
            </div>
            <Download className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </Modal>
    </>
  );
};
