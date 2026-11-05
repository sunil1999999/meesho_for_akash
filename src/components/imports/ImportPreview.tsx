import React, { useState, useEffect, useMemo } from 'react';
import { ImportFileResult, DuplicateResolutionStrategy, DeliveryAddress } from '../../types';
import { getAllKnownAddresses, savePresetAddress, validateAddressForCheckout } from '../../lib/addressStorage';
import { Badge } from '../common/Badge';
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  Copy,
  ShieldAlert,
  ArrowRight,
  MapPin,
  MapPinOff,
  Plus,
  Home,
  Briefcase,
  X,
  Check,
} from 'lucide-react';

interface ImportPreviewProps {
  fileResults: ImportFileResult[];
  duplicateStrategy: DuplicateResolutionStrategy;
  onStrategyChange: (strategy: DuplicateResolutionStrategy) => void;
  onConfirmImport: (accountAddressMap: Record<string, DeliveryAddress | null>) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  totalValid: number;
  totalInvalid: number;
  totalBatchDuplicates: number;
  totalDbDuplicates: number;
  totalConflicts: number;
}

export const ImportPreview: React.FC<ImportPreviewProps> = ({
  fileResults,
  duplicateStrategy,
  onStrategyChange,
  onConfirmImport,
  onCancel,
  isSubmitting,
  totalValid,
  totalInvalid,
  totalBatchDuplicates,
  totalDbDuplicates,
  totalConflicts,
}) => {
  const totalParsed = fileResults.reduce((acc, f) => acc + f.total_records, 0);

  // Address selection state
  const [availableAddresses, setAvailableAddresses] = useState<DeliveryAddress[]>([]);
  const [accountAddressMap, setAccountAddressMap] = useState<Record<string, DeliveryAddress | null>>({});
  const [isAddAddressModalOpen, setIsAddAddressModalOpen] = useState(false);
  const [targetPhoneForNewAddress, setTargetPhoneForNewAddress] = useState<string | null>(null);

  // New address form state
  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newState, setNewState] = useState('');
  const [newLine1, setNewLine1] = useState('');
  const [newLine2, setNewLine2] = useState('');
  const [newLandmark, setNewLandmark] = useState('');
  const [newAddressType, setNewAddressType] = useState('Home');
  const [newAddressError, setNewAddressError] = useState<string | null>(null);

  // Load saved addresses on mount
  useEffect(() => {
    const list = getAllKnownAddresses();
    setAvailableAddresses(list);
  }, []);

  // Collect distinct valid accounts from parsed files
  const validAccounts = useMemo(() => {
    const list: Array<{
      normalized_phone: string;
      display_phone: string;
      source_file?: string;
    }> = [];
    const seen = new Set<string>();
    fileResults.forEach(f => {
      f.records.forEach(rec => {
        if (rec.is_valid && rec.normalized_phone && !seen.has(rec.normalized_phone)) {
          seen.add(rec.normalized_phone);
          list.push({
            normalized_phone: rec.normalized_phone,
            display_phone: rec.display_phone,
            source_file: rec.source_file || f.file_name,
          });
        }
      });
    });
    return list;
  }, [fileResults]);

  const handleSelectAddressForAccount = (phone: string, addr: DeliveryAddress | null) => {
    setAccountAddressMap(prev => ({
      ...prev,
      [phone]: addr,
    }));
  };

  const handleOpenAddAddressModal = (forPhone?: string) => {
    setTargetPhoneForNewAddress(forPhone || validAccounts[0]?.normalized_phone || null);
    setNewName('');
    setNewMobile(forPhone ? forPhone.replace(/\D/g, '').slice(-10) : '');
    setNewPin('');
    setNewCity('');
    setNewState('');
    setNewLine1('');
    setNewLine2('');
    setNewLandmark('');
    setNewAddressType('Home');
    setNewAddressError(null);
    setIsAddAddressModalOpen(true);
  };

  const handleSaveNewAddress = (e: React.FormEvent) => {
    e.preventDefault();
    setNewAddressError(null);

    const payload: Partial<DeliveryAddress> = {
      name: newName,
      mobile: newMobile,
      pin: newPin,
      city: newCity,
      state: newState,
      address_line_1: newLine1,
      address_line_2: newLine2,
      landmark: newLandmark,
      address_type: newAddressType,
    };

    const val = validateAddressForCheckout(payload);
    if (!val.valid) {
      setNewAddressError(val.error || 'Please fill required address fields');
      return;
    }

    try {
      const saved = savePresetAddress(payload);
      const updatedList = getAllKnownAddresses();
      setAvailableAddresses(updatedList);

      // If a target account was open, select this new address for it
      if (targetPhoneForNewAddress) {
        handleSelectAddressForAccount(targetPhoneForNewAddress, saved);
      }
      setIsAddAddressModalOpen(false);
    } catch (err: any) {
      setNewAddressError(err.message || 'Failed to save address');
    }
  };


  return (
    <div className="space-y-6">
      {/* Metrics Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 font-medium">Total Parsed</span>
          <p className="text-xl font-bold text-slate-100 font-mono mt-0.5">{totalParsed}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-emerald-400 font-medium">Valid Accounts</span>
          <p className="text-xl font-bold text-emerald-300 font-mono mt-0.5">{totalValid}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-rose-400 font-medium">Invalid Numbers</span>
          <p className="text-xl font-bold text-rose-300 font-mono mt-0.5">{totalInvalid}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-amber-400 font-medium">Batch Duplicates</span>
          <p className="text-xl font-bold text-amber-300 font-mono mt-0.5">{totalBatchDuplicates}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-cyan-400 font-medium">Existing in DB</span>
          <p className="text-xl font-bold text-cyan-300 font-mono mt-0.5">{totalDbDuplicates}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-pink-400 font-medium">Identity Conflicts</span>
          <p className="text-xl font-bold text-pink-300 font-mono mt-0.5">{totalConflicts}</p>
        </div>
      </div>

      {/* Duplicate Resolution Strategy Chooser */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3">
        <div className="flex items-center gap-2">
          <Copy className="w-4 h-4 text-pink-400" />
          <h4 className="text-sm font-semibold text-slate-200">
            Duplicate Mobile Number Resolution Strategy
          </h4>
        </div>
        <p className="text-xs text-slate-400">
          How should incoming records be handled when their normalized mobile number already exists?
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {[
            {
              id: 'skip',
              title: 'Skip Incoming',
              desc: 'Keep existing record unchanged, ignore incoming duplicate.',
            },
            {
              id: 'update_approved',
              title: 'Update Approved Fields',
              desc: 'Update existing record JSON and timestamp.',
            },
            {
              id: 'review',
              title: 'Flag for Review',
              desc: 'Mark existing record status as review_required.',
            },
            {
              id: 'manual',
              title: 'Manual Resolution Queue',
              desc: 'Route to manual conflict resolution desk.',
            },
          ].map(opt => {
            const isSelected = duplicateStrategy === opt.id;
            return (
              <label
                key={opt.id}
                onClick={() => onStrategyChange(opt.id as any)}
                className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'bg-pink-950/40 border-pink-600 text-slate-100 ring-1 ring-pink-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-200">{opt.title}</span>
                    <input
                      type="radio"
                      name="dupStrategy"
                      checked={isSelected}
                      onChange={() => onStrategyChange(opt.id as any)}
                      className="text-pink-600 focus:ring-pink-500"
                    />
                  </div>
                  <p className="text-[11px] leading-snug">{opt.desc}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Per-File Breakdown */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Files in Batch ({fileResults.length})
          </h4>
          <span className="text-[11px] text-slate-500">
            Preview displays normalized mobile numbers only
          </span>
        </div>

        <div className="divide-y divide-slate-800/80">
          {fileResults.map((file, fIdx) => (
            <div key={fIdx} className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-pink-400" />
                  <span className="font-semibold text-slate-200 text-sm font-mono">
                    {file.file_name}
                  </span>
                  <span className="text-xs text-slate-500">
                    ({(file.file_size / 1024).toFixed(1)} KB, {file.file_type.toUpperCase()})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="success" size="sm">
                    {file.valid_records} valid
                  </Badge>
                  {file.invalid_records > 0 && (
                    <Badge variant="danger" size="sm">
                      {file.invalid_records} invalid
                    </Badge>
                  )}
                  {file.duplicates_in_file > 0 && (
                    <Badge variant="warning" size="sm">
                      {file.duplicates_in_file} in-file dups
                    </Badge>
                  )}
                </div>
              </div>

              {/* Sample Mobile Numbers Preview */}
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80">
                <span className="text-[11px] text-slate-400 font-medium block mb-1.5">
                  Parsed Mobile Numbers Preview ({Math.min(file.records.length, 6)} of {file.records.length}):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {file.records.slice(0, 6).map((rec, rIdx) => (
                    <span
                      key={rIdx}
                      className={`px-2 py-0.5 rounded text-xs font-mono border ${
                        rec.is_valid
                          ? rec.has_conflict
                            ? 'bg-rose-950/60 text-rose-300 border-rose-800'
                            : rec.is_duplicate_in_db
                            ? 'bg-cyan-950/60 text-cyan-300 border-cyan-800'
                            : 'bg-slate-800 text-slate-200 border-slate-700'
                          : 'bg-rose-950 text-rose-400 border-rose-900'
                      }`}
                    >
                      {rec.display_phone}
                      {rec.has_conflict && ' [Conflict]'}
                      {rec.is_duplicate_in_db && ' [In DB]'}
                    </span>
                  ))}
                  {file.records.length > 6 && (
                    <span className="px-2 py-0.5 text-xs text-slate-500">
                      +{file.records.length - 6} more
                    </span>
                  )}
                </div>
              </div>

              {/* Parsing Warnings / Errors */}
              {file.parse_errors.length > 0 && (
                <div className="bg-rose-950/30 border border-rose-900/60 p-2.5 rounded-lg text-xs text-rose-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-rose-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Parser Diagnostics:</span>
                  </div>
                  {file.parse_errors.slice(0, 3).map((err, eIdx) => (
                    <p key={eIdx} className="font-mono text-[11px] text-rose-200/80">
                      • {err}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Address Assignment Step: Requirement 2 & 3 */}
      {validAccounts.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-pink-400" />
                <h4 className="text-sm font-bold text-slate-100">
                  {validAccounts.length === 1
                    ? `Assign Delivery Address (Optional) — ${validAccounts[0].display_phone}`
                    : `Manual Address Selection Per Account (${validAccounts.length} Accounts)`}
                </h4>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {validAccounts.length === 1
                  ? 'Addresses are never automatically added to all accounts. Select which saved address, if any, should be assigned to this specific account.'
                  : 'Strict isolation: addresses are never automatically shared across accounts. Select an address separately for each account, or choose "No Address".'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleOpenAddAddressModal()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-950/80 hover:bg-pink-900/80 text-pink-300 border border-pink-700/60 text-xs font-semibold transition-colors cursor-pointer self-start sm:self-auto shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add New Address</span>
            </button>
          </div>

          {/* Case A: Single Account Import */}
          {validAccounts.length === 1 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* 1. "No Address" Option */}
                <label
                  onClick={() => handleSelectAddressForAccount(validAccounts[0].normalized_phone, null)}
                  className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between ${
                    accountAddressMap[validAccounts[0].normalized_phone] == null
                      ? 'bg-pink-950/40 border-pink-500 text-slate-100 ring-1 ring-pink-500'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                        <MapPinOff className="w-4 h-4 text-slate-400" />
                        No Address
                      </span>
                      <input
                        type="radio"
                        name="singleAccountAddress"
                        checked={accountAddressMap[validAccounts[0].normalized_phone] == null}
                        onChange={() => handleSelectAddressForAccount(validAccounts[0].normalized_phone, null)}
                        className="text-pink-600 focus:ring-pink-500"
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      Import without assigning a delivery address. Address remains empty and can be assigned manually later.
                    </p>
                  </div>
                  <span className="mt-2 text-[10px] text-slate-500 font-medium">Recommended default</span>
                </label>

                {/* 2. Available Saved Addresses */}
                {availableAddresses.map(addr => {
                  const isSelected =
                    accountAddressMap[validAccounts[0].normalized_phone]?.local_id === addr.local_id ||
                    (addr.id > 0 && accountAddressMap[validAccounts[0].normalized_phone]?.id === addr.id);

                  return (
                    <label
                      key={addr.local_id || addr.id}
                      onClick={() => handleSelectAddressForAccount(validAccounts[0].normalized_phone, addr)}
                      className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between ${
                        isSelected
                          ? 'bg-pink-950/40 border-pink-500 text-slate-100 ring-1 ring-pink-500'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                            {addr.address_type === 'Work' ? (
                              <Briefcase className="w-3.5 h-3.5 text-cyan-400" />
                            ) : (
                              <Home className="w-3.5 h-3.5 text-emerald-400" />
                            )}
                            {addr.name}
                          </span>
                          <input
                            type="radio"
                            name="singleAccountAddress"
                            checked={isSelected}
                            onChange={() => handleSelectAddressForAccount(validAccounts[0].normalized_phone, addr)}
                            className="text-pink-600 focus:ring-pink-500"
                          />
                        </div>
                        <p className="text-[11px] text-slate-300 font-mono">+91 {addr.mobile}</p>
                        <p className="text-[11px] text-slate-300 line-clamp-1 mt-0.5">{addr.address_line_1}</p>
                        <p className="text-[11px] text-slate-400">
                          {addr.city}, {addr.state} - <strong className="text-slate-200 font-mono">{addr.pin}</strong>
                        </p>
                      </div>
                      <span className="mt-2 text-[10px] text-pink-400/80 font-medium">
                        Apply to {validAccounts[0].display_phone} only
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Case B: Bulk Import (Multiple Accounts) */
            <div className="space-y-2">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider bg-slate-950/60">
                      <th className="py-2.5 px-3">Account Mobile</th>
                      <th className="py-2.5 px-3">Source File</th>
                      <th className="py-2.5 px-3">Assigned Address (Isolated per Account)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {validAccounts.map((acc, idx) => {
                      const selected = accountAddressMap[acc.normalized_phone] || null;
                      return (
                        <tr key={idx} className="hover:bg-slate-950/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-200">
                            {acc.display_phone}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                            {acc.source_file || 'import'}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <select
                                value={selected ? (selected.local_id || String(selected.id)) : 'none'}
                                onChange={e => {
                                  const val = e.target.value;
                                  if (val === 'none') {
                                    handleSelectAddressForAccount(acc.normalized_phone, null);
                                  } else {
                                    const match = availableAddresses.find(
                                      a => (a.local_id && a.local_id === val) || String(a.id) === val
                                    );
                                    if (match) handleSelectAddressForAccount(acc.normalized_phone, match);
                                  }
                                }}
                                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-pink-500 max-w-sm"
                              >
                                <option value="none">No Address (Do not assign)</option>
                                {availableAddresses.map(a => (
                                  <option key={a.local_id || a.id} value={a.local_id || a.id}>
                                    {a.name} — {a.city}, {a.pin} ({a.address_line_1})
                                  </option>
                                ))}
                              </select>

                              {selected && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                                  <Check className="w-3 h-3" />
                                  <span>Assigned</span>
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
        >
          Cancel Batch
        </button>

        <button
          onClick={() => onConfirmImport(accountAddressMap)}
          disabled={isSubmitting || totalValid === 0}
          className="flex items-center gap-2 px-6 py-2.5 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold shadow-lg shadow-pink-950/50 transition-all cursor-pointer"
        >
          {isSubmitting ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Committing Records...</span>
            </div>
          ) : (
            <>
              <span>Commit Import ({totalValid} Records)</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>

      {/* Add New Address Modal */}
      {isAddAddressModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative space-y-4">
            <button
              onClick={() => setIsAddAddressModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-pink-950/80 border border-pink-700/60 flex items-center justify-center text-pink-400">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-100 text-sm">Save New Delivery Address</h3>
                <p className="text-xs text-slate-400">
                  Adds address to saved list and assigns it to selected account
                </p>
              </div>
            </div>

            {newAddressError && (
              <div className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-800 text-xs text-rose-300">
                {newAddressError}
              </div>
            )}

            <form onSubmit={handleSaveNewAddress} className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">
                    Recipient Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Full Name"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">
                    Mobile Number *
                  </label>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    value={newMobile}
                    onChange={e => setNewMobile(e.target.value.replace(/\D/g, ''))}
                    placeholder="10-digit mobile"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">
                  Address Line 1 (House / Street) *
                </label>
                <input
                  type="text"
                  required
                  value={newLine1}
                  onChange={e => setNewLine1(e.target.value)}
                  placeholder="Flat/House No, Building, Street"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">
                  Address Line 2 / Landmark
                </label>
                <input
                  type="text"
                  value={newLine2}
                  onChange={e => setNewLine2(e.target.value)}
                  placeholder="Area, Colony, Landmark"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">
                    PIN Code *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="6-digit PIN"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCity}
                    onChange={e => setNewCity(e.target.value)}
                    placeholder="City"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    required
                    value={newState}
                    onChange={e => setNewState(e.target.value)}
                    placeholder="State"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-pink-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 uppercase mb-1">
                  Address Type
                </label>
                <div className="flex gap-2">
                  {['Home', 'Work'].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewAddressType(t)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        newAddressType === t
                          ? 'bg-pink-950/80 text-pink-300 border-pink-600'
                          : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddAddressModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Save Address
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
