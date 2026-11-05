import React, { useState, useEffect } from 'react';
import { AccountRecord, DeliveryAddress } from '../../types';
import { Modal } from '../common/Modal';
import { StorageService } from '../../lib/storageAdapter';
import { useApp } from '../../context/AppContext';
import { getAccountAssignedAddress, getAllKnownAddresses } from '../../lib/addressStorage';
import { Tag, Save, Plus, X, MapPin } from 'lucide-react';

interface AccountEditModalProps {
  account: AccountRecord | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AccountEditModal: React.FC<AccountEditModalProps> = ({
  account,
  isOpen,
  onClose,
}) => {
  const { showToast, refreshData } = useApp();

  const [status, setStatus] = useState<any>('active');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // Address selection state
  const [presetAddresses, setPresetAddresses] = useState<DeliveryAddress[]>([]);
  const [selectedAddrId, setSelectedAddrId] = useState<string>('none');

  useEffect(() => {
    if (account) {
      setStatus(account.record_status);
      setTags(account.tags || []);
      setNotes(account.notes || '');

      const presets = getAllKnownAddresses();
      setPresetAddresses(presets);

      const cur = getAccountAssignedAddress(account);
      if (cur) {
        setSelectedAddrId(cur.local_id || String(cur.id));
      } else {
        setSelectedAddrId('none');
      }
    }
  }, [account]);

  if (!account) return null;

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await StorageService.updateAccount(account.id, {
        record_status: status,
        monitoring_status: status === 'sold' ? 'sold_excluded' : account.monitoring_status,
        next_check_at: status === 'sold' ? undefined : account.next_check_at,
        tags,
        notes,
      });

      // Update assigned address
      if (selectedAddrId === 'none') {
        await StorageService.assignAccountAddress(account.id, null);
      } else {
        const matching = presetAddresses.find(
          a => (a.local_id && a.local_id === selectedAddrId) || String(a.id) === selectedAddrId
        );
        if (matching) {
          await StorageService.assignAccountAddress(account.id, matching);
        }
      }

      if (!updated) {
        throw new Error('Failed to update account record in storage');
      }
      showToast(
        status === 'sold'
          ? `Marked ${account.phone_display} as SOLD (Permanently Excluded from polling)`
          : `Updated metadata and address for ${account.phone_display}`,
        'success',
        true
      );
      refreshData();
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Failed to save account changes', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Account: ${account.phone_display}`}
      subtitle="Modify permitted status, tags, and internal operational notes"
      maxWidth="md"
    >
      <form onSubmit={handleSave} className="space-y-4">
        {/* Status Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Record Status
          </label>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
          >
            <option value="active">Active (Normal Operation)</option>
            <option value="sold">Sold (Permanently Excluded from Polling)</option>
            <option value="review_required">Review Required</option>
            <option value="conflict">Identity Conflict</option>
            <option value="invalid">Invalid Data Format</option>
            <option value="archived">Archived</option>
          </select>
          {status === 'sold' && (
            <div className="mt-2 p-2.5 bg-purple-950/50 border border-purple-800/80 rounded-lg text-xs text-purple-200">
              <span className="font-semibold text-purple-300">Permanently Excluded:</span> This account is excluded from background polling cycles and hidden from Direct Checkout & Pay.
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Account Tags
          </label>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              placeholder="Add tag (e.g. vip, verified, bulk_seller)..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500 font-mono"
            />
            <button
              type="button"
              onClick={handleAddTag}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 min-h-[30px] p-2 bg-slate-950/70 border border-slate-800/80 rounded-lg">
            {tags.length === 0 ? (
              <span className="text-xs text-slate-600 italic">No tags assigned</span>
            ) : (
              tags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-pink-950/80 text-pink-300 border border-pink-700/60 font-mono"
                >
                  <Tag className="w-2.5 h-2.5" />
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        {/* Operational Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Operational Notes
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Add internal notes for compliance or audit..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500 leading-relaxed"
          />
        </div>

        {/* Assigned Delivery Address (Requirement 4) */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-pink-400" />
            <span>Assigned Delivery Address</span>
          </label>
          <select
            value={selectedAddrId}
            onChange={e => setSelectedAddrId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
          >
            <option value="none">No Address (Do not assign)</option>
            {presetAddresses.map(addr => (
              <option key={addr.local_id || addr.id} value={addr.local_id || addr.id}>
                {addr.name} — {addr.city}, {addr.pin} ({addr.address_line_1})
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-400 mt-1 block">
            Changes apply strictly to this account upon clicking &quot;Save Changes&quot;.
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end items-center gap-3 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold shadow-md transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
