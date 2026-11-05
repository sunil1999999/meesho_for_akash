import React, { useState, useRef } from 'react';
import { AccountRecord, ReconciliationDiffItem } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { normalizePhoneNumber } from '../lib/phoneUtils';
import { triggerFileDownload } from '../lib/exportUtils';
import { Badge } from '../components/common/Badge';
import {
  FileSpreadsheet,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Download,
  Filter,
} from 'lucide-react';

export const CsvReconciliationView: React.FC = () => {
  const { showToast, refreshData } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<'upload' | 'mapping' | 'diff' | 'summary'>('upload');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [matchingKey, setMatchingKey] = useState<string>('phone');
  const [phoneColumn, setPhoneColumn] = useState<string>('');
  const [diffItems, setDiffItems] = useState<ReconciliationDiffItem[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [appliedCount, setAppliedCount] = useState<number>(0);

  // Handle CSV file upload & parsing
  const handleCsvUpload = async (file: File) => {
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) {
        showToast('CSV must contain a header row and at least one data row', 'error');
        return;
      }

      // Simple CSV parser respecting basic quotes
      const parseCsvLine = (line: string): string[] => {
        const result: string[] = [];
        let curr = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') {
            inQuotes = !inQuotes;
          } else if (c === ',' && !inQuotes) {
            result.push(curr.trim());
            curr = '';
          } else {
            curr += c;
          }
        }
        result.push(curr.trim());
        return result.map(s => s.replace(/^"|"$/g, ''));
      };

      const headers = parseCsvLine(lines[0]);
      const rows: Record<string, string>[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const rowObj: Record<string, string> = {};
        headers.forEach((h, idx) => {
          rowObj[h] = values[idx] || '';
        });
        rows.push(rowObj);
      }

      setCsvHeaders(headers);
      setCsvRows(rows);

      // Guess phone column
      const detectedPhoneCol = headers.find(h =>
        ['phone', 'mobile', 'mobile_no', 'phone_number', 'contact'].includes(h.toLowerCase())
      ) || headers[0];
      setPhoneColumn(detectedPhoneCol);

      setStep('mapping');
      showToast(`Loaded CSV with ${rows.length} rows`, 'success');
    } catch {
      showToast('Failed to parse CSV file', 'error');
    }
  };

  // Run Diff Analysis
  const handleRunReconciliation = async () => {
    const existingAccounts = await StorageService.getAccounts({ pageSize: 5000 });
    const existingMap = new Map<string, AccountRecord>();
    existingAccounts.accounts.forEach(a => {
      existingMap.set(a.phone_normalized, a);
    });

    const diffs: ReconciliationDiffItem[] = [];
    const seenCsvKeys = new Set<string>();

    csvRows.forEach((row, index) => {
      const rawVal = row[phoneColumn];
      const parsedPhone = normalizePhoneNumber(rawVal);
      const key = parsedPhone.normalized || rawVal;

      if (!parsedPhone.isValid) {
        diffs.push({
          id: `diff_${index}`,
          matching_key: key,
          status: 'conflict',
          source_row: row,
          field_changes: [],
          selected_to_apply: false,
          notes: `Invalid mobile number: ${rawVal}`,
        });
        return;
      }

      if (seenCsvKeys.has(key)) {
        diffs.push({
          id: `diff_${index}`,
          matching_key: key,
          status: 'conflict',
          source_row: row,
          field_changes: [],
          selected_to_apply: false,
          notes: 'Duplicate matching key found inside CSV file',
        });
        return;
      }
      seenCsvKeys.add(key);

      const existing = existingMap.get(key);

      if (!existing) {
        // New record
        diffs.push({
          id: `diff_${index}`,
          matching_key: key,
          status: 'new',
          source_row: row,
          field_changes: [],
          selected_to_apply: true,
          notes: 'Record present in CSV but missing from database',
        });
      } else {
        // Compare values
        const changes: Array<{ field: string; old_value: any; new_value: any }> = [];
        Object.entries(row).forEach(([col, val]) => {
          if (col !== phoneColumn && val) {
            const existingVal = existing.account_json[col];
            if (existingVal !== undefined && String(existingVal) !== String(val)) {
              changes.push({
                field: col,
                old_value: existingVal,
                new_value: val,
              });
            }
          }
        });

        if (changes.length > 0) {
          diffs.push({
            id: `diff_${index}`,
            matching_key: key,
            status: 'changed',
            source_row: row,
            existing_record: existing,
            field_changes: changes,
            selected_to_apply: true,
            notes: `${changes.length} field difference(s) detected`,
          });
        } else {
          diffs.push({
            id: `diff_${index}`,
            matching_key: key,
            status: 'matching',
            source_row: row,
            existing_record: existing,
            field_changes: [],
            selected_to_apply: false,
            notes: 'Existing database record already matches CSV',
          });
        }
      }
    });

    setDiffItems(diffs);
    setStep('diff');
  };

  // Apply Selected Changes
  const handleApplyChanges = async () => {
    setIsApplying(true);
    let count = 0;
    try {
      const selected = diffItems.filter(d => d.selected_to_apply);

      for (const item of selected) {
        if (item.status === 'new') {
          // Insert new account
          const p = normalizePhoneNumber(item.matching_key);
          await StorageService.insertAccount({
            phone_normalized: p.normalized,
            phone_display: p.display,
            account_json: { ...item.source_row, mobile: p.normalized },
            record_status: 'active',
            tags: ['reconciled'],
            source_file: 'reconciliation_import.csv',
            is_archived: false,
          });
          count++;
        } else if (item.status === 'changed' && item.existing_record) {
          // Merge approved changes
          const updatedJson = { ...item.existing_record.account_json };
          item.field_changes.forEach(c => {
            updatedJson[c.field] = c.new_value;
          });
          await StorageService.updateAccount(item.existing_record.id, {
            account_json: updatedJson,
            tags: [...(item.existing_record.tags || []), 'reconciled'],
          });
          count++;
        }
      }

      setAppliedCount(count);
      setStep('summary');
      showToast(`Successfully reconciled and applied ${count} records`, 'success');
      refreshData();
    } catch {
      showToast('Reconciliation apply failed', 'error');
    } finally {
      setIsApplying(false);
    }
  };

  // Download Reconciliation Report as CSV
  const handleDownloadReport = () => {
    const headers = ['Matching Key', 'Category', 'Notes', 'Field Changes'];
    const rows = diffItems.map(d => [
      `"${d.matching_key}"`,
      `"${d.status}"`,
      `"${(d.notes || '').replace(/"/g, '""')}"`,
      `"${d.field_changes.map(c => `${c.field}: ${c.old_value} -> ${c.new_value}`).join('; ')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    triggerFileDownload(csv, `reconciliation_report_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    showToast('Downloaded Reconciliation Report CSV', 'success');
  };

  // Synthetic sample CSV loader
  const loadSyntheticReconciliationSample = () => {
    const sample = `mobile,user_id,status_tier,notes
9033807401,usr_meesho_892104,VIP_PLATINUM,Existing active customer updated tier
9820192831,usr_meesho_471920,TIER_1,Existing customer unchanged
9999912345,usr_new_001,REGULAR,Brand new customer found in logistics export
invalid_number_abc,usr_inv,NONE,Malformed phone
9123456780,usr_meesho_193821,REVIEWED,Status tier upgrade`;

    const blob = new Blob([sample], { type: 'text/csv' });
    const file = new File([blob], 'sample_reconciliation.csv', { type: 'text/csv' });
    handleCsvUpload(file);
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">CSV Reconciliation Engine</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Compare external spreadsheet data against the PostgreSQL database. Compute diffs, detect conflicts, and apply approved updates safely.
          </p>
        </div>

        {step === 'upload' && (
          <button
            onClick={loadSyntheticReconciliationSample}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-pink-950/80 hover:bg-pink-900/80 text-pink-300 border border-pink-700/60 rounded-xl text-xs font-medium transition-colors self-start sm:self-auto cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Load Sample CSV</span>
          </button>
        )}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-900/80 rounded-2xl p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={e => e.target.files?.[0] && handleCsvUpload(e.target.files[0])}
            className="hidden"
          />
          <div className="w-16 h-16 rounded-2xl bg-pink-950/80 border border-pink-700/60 flex items-center justify-center mb-4 text-pink-400">
            <UploadCloud className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-slate-100">Upload CSV Spreadsheet</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm">
            Upload CSV containing external orders, courier updates, or account rosters.
          </p>
        </div>
      )}

      {/* Step 2: Mapping */}
      {step === 'mapping' && (
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100">Step 2: Map Matching Key</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Choose the column containing the primary business key for matching.
              </p>
            </div>
            <span className="text-xs font-mono text-pink-400">
              {csvRows.length} Rows Detected
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Matching Key Type
              </label>
              <select
                value={matchingKey}
                onChange={e => setMatchingKey(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 font-medium"
              >
                <option value="phone">Normalized Mobile Number</option>
                <option value="order_id">External Order ID</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                CSV Source Column
              </label>
              <select
                value={phoneColumn}
                onChange={e => setPhoneColumn(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 font-mono"
              >
                {csvHeaders.map(h => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Sample Row Preview */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
            <span className="text-xs font-semibold text-slate-400 block mb-2">
              Sample Row Header Mapping:
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {Object.entries(csvRows[0] || {}).map(([k, v]) => (
                <div key={k} className="p-2 bg-slate-900 rounded border border-slate-800">
                  <span className="text-slate-500 font-mono text-[10px] block">{k}:</span>
                  <span className="text-slate-200 font-mono truncate block">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <button
              onClick={() => setStep('upload')}
              className="px-4 py-2 text-xs text-slate-400 hover:text-white"
            >
              Back to Upload
            </button>
            <button
              onClick={handleRunReconciliation}
              className="flex items-center gap-2 px-5 py-2.5 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <span>Compute Differences</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Diff Comparison Table */}
      {step === 'diff' && (
        <div className="space-y-4">
          {/* Summary Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'New Records', count: diffItems.filter(d => d.status === 'new').length, color: 'text-emerald-400' },
              { label: 'Changed Values', count: diffItems.filter(d => d.status === 'changed').length, color: 'text-amber-400' },
              { label: 'Identical Match', count: diffItems.filter(d => d.status === 'matching').length, color: 'text-slate-400' },
              { label: 'Conflicts / Invalid', count: diffItems.filter(d => d.status === 'conflict').length, color: 'text-rose-400' },
            ].map((st, i) => (
              <div key={i} className="p-3 bg-slate-900 border border-slate-800 rounded-xl">
                <span className="text-[11px] text-slate-500 block">{st.label}</span>
                <span className={`text-xl font-bold font-mono ${st.color}`}>{st.count}</span>
              </div>
            ))}
          </div>

          {/* Action Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
            <div className="flex items-center gap-1.5 text-xs">
              {['all', 'new', 'changed', 'conflict'].map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg capitalize font-medium transition-colors cursor-pointer ${
                    filterCategory === cat
                      ? 'bg-pink-700 text-white'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadReport}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Report CSV</span>
              </button>
              <button
                onClick={handleApplyChanges}
                disabled={isApplying || diffItems.filter(d => d.selected_to_apply).length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                <span>
                  Apply Approved Changes ({diffItems.filter(d => d.selected_to_apply).length})
                </span>
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
                    <th className="py-3.5 px-4 w-12 text-center">Apply</th>
                    <th className="py-3.5 px-4">Matching Key</th>
                    <th className="py-3.5 px-4">Category</th>
                    <th className="py-3.5 px-4">Details & Field Differences</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {diffItems
                    .filter(d => filterCategory === 'all' || d.status === filterCategory)
                    .map(item => (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="checkbox"
                            checked={item.selected_to_apply}
                            onChange={() => {
                              item.selected_to_apply = !item.selected_to_apply;
                              setDiffItems([...diffItems]);
                            }}
                            disabled={item.status === 'matching' || item.status === 'conflict'}
                            className="rounded border-slate-700 text-pink-600 focus:ring-pink-500 bg-slate-950"
                          />
                        </td>
                        <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">
                          {item.matching_key}
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge
                            variant={
                              item.status === 'new'
                                ? 'success'
                                : item.status === 'changed'
                                ? 'warning'
                                : item.status === 'conflict'
                                ? 'danger'
                                : 'neutral'
                            }
                            size="sm"
                          >
                            {item.status}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4">
                          {item.field_changes.length > 0 ? (
                            <div className="space-y-1">
                              {item.field_changes.map((c, idx) => (
                                <p key={idx} className="font-mono text-[11px] text-slate-300">
                                  <span className="text-pink-400">{c.field}</span>: {String(c.old_value)} →{' '}
                                  <strong className="text-emerald-300">{String(c.new_value)}</strong>
                                </p>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400">{item.notes}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Summary */}
      {step === 'summary' && (
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center space-y-4 max-w-lg mx-auto shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-emerald-950/80 border border-emerald-700/60 flex items-center justify-center text-emerald-400 mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-100">Reconciliation Applied</h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Applied <strong>{appliedCount}</strong> updates and new records to the database. All operations have been recorded in the audit log.
          </p>

          <div className="flex justify-center gap-3 pt-2">
            <button
              onClick={handleDownloadReport}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold"
            >
              Download Report CSV
            </button>
            <button
              onClick={() => {
                setStep('upload');
                setDiffItems([]);
              }}
              className="px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold"
            >
              Start New Reconciliation
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
