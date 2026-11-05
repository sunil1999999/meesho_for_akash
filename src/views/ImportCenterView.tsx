import React, { useState } from 'react';
import { ImportFileResult, DuplicateResolutionStrategy } from '../types';
import { ImportDropzone } from '../components/imports/ImportDropzone';
import { ImportPreview } from '../components/imports/ImportPreview';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { UploadCloud, CheckCircle2, AlertCircle } from 'lucide-react';

export const ImportCenterView: React.FC = () => {
  const { showToast, refreshData, setActiveTab, setAccountSearchQuery } = useApp();

  const [fileResults, setFileResults] = useState<ImportFileResult[] | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateResolutionStrategy>('skip');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastSummary, setLastSummary] = useState<{
    inserted: number;
    updated: number;
    skipped: number;
    files: number;
  } | null>(null);

  const handleParsedResults = (results: ImportFileResult[]) => {
    setFileResults(results);
    setLastSummary(null);
  };

  const handleConfirmImport = async (accountAddressMap: Record<string, any> = {}) => {
    if (!fileResults || fileResults.length === 0) return;
    setIsSubmitting(true);

    try {
      // Flatten all valid records
      const allRecordsToSave: Array<{
        raw_json: Record<string, any>;
        normalized_phone: string;
        display_phone: string;
        source_file?: string;
        selected_address?: any;
      }> = [];

      fileResults.forEach(f => {
        f.records.forEach(rec => {
          if (rec.is_valid && rec.normalized_phone) {
            allRecordsToSave.push({
              raw_json: rec.raw_json,
              normalized_phone: rec.normalized_phone,
              display_phone: rec.display_phone,
              source_file: rec.source_file,
              selected_address: accountAddressMap[rec.normalized_phone] ?? null,
            });
          }
        });
      });

      const { inserted, updated, skipped } = await StorageService.saveBatchAccounts(
        allRecordsToSave,
        duplicateStrategy
      );

      setLastSummary({
        inserted,
        updated,
        skipped,
        files: fileResults.length,
      });

      showToast(
        `Import complete: ${inserted} inserted, ${updated} updated, ${skipped} skipped`,
        'success'
      );
      refreshData();
      setFileResults(null);
    } catch (err: any) {
      showToast(`Import failed: ${err?.message || 'Database error'}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Compute total metrics across fileResults
  const totalValid = fileResults?.reduce((acc, f) => acc + f.valid_records, 0) || 0;
  const totalInvalid = fileResults?.reduce((acc, f) => acc + f.invalid_records, 0) || 0;
  const totalBatchDuplicates = fileResults?.reduce((acc, f) => acc + f.duplicates_in_file, 0) || 0;
  const totalDbDuplicates = fileResults?.reduce((acc, f) => acc + f.duplicates_in_db, 0) || 0;
  const totalConflicts = fileResults?.reduce((acc, f) => acc + f.conflicts, 0) || 0;

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">Multi-File Import Center</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Batch-import accounts from .json, .txt, .jsonl, and .ndjson files. Handles single objects, arrays, and consecutive pretty-printed JSONs.
          </p>
        </div>
      </div>

      {/* Success Summary Banner if just completed */}
      {lastSummary && (
        <div className="p-4 bg-emerald-950/40 border border-emerald-700/60 rounded-xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-emerald-200">
                Batch Import Completed Successfully
              </h4>
              <p className="text-xs text-emerald-300/80 mt-0.5">
                Processed {lastSummary.files} file(s):{' '}
                <strong>{lastSummary.inserted}</strong> new accounts added,{' '}
                <strong>{lastSummary.updated}</strong> updated,{' '}
                <strong>{lastSummary.skipped}</strong> skipped duplicates.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setAccountSearchQuery('');
              setActiveTab('accounts');
            }}
            className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs font-semibold rounded-lg transition-colors shrink-0 cursor-pointer"
          >
            Go to Accounts Table
          </button>
        </div>
      )}

      {/* Dropzone or Preview */}
      {!fileResults ? (
        <ImportDropzone onParsedResults={handleParsedResults} />
      ) : (
        <ImportPreview
          fileResults={fileResults}
          duplicateStrategy={duplicateStrategy}
          onStrategyChange={setDuplicateStrategy}
          onConfirmImport={handleConfirmImport}
          onCancel={() => setFileResults(null)}
          isSubmitting={isSubmitting}
          totalValid={totalValid}
          totalInvalid={totalInvalid}
          totalBatchDuplicates={totalBatchDuplicates}
          totalDbDuplicates={totalDbDuplicates}
          totalConflicts={totalConflicts}
        />
      )}
    </div>
  );
};
