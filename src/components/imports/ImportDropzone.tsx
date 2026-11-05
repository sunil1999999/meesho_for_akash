import React, { useRef, useState } from 'react';
import { ImportFileResult } from '../../types';
import { parseRawFileContent, analyzeBatchRecords } from '../../lib/jsonParser';
import { StorageService } from '../../lib/storageAdapter';
import { useApp } from '../../context/AppContext';
import {
  UploadCloud,
  FileText,
  FileCode,
  Sparkles,
  AlertCircle,
} from 'lucide-react';

interface ImportDropzoneProps {
  onParsedResults: (results: ImportFileResult[]) => void;
}

export const ImportDropzone: React.FC<ImportDropzoneProps> = ({ onParsedResults }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const { showToast } = useApp();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setParsing(true);

    try {
      const results: ImportFileResult[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = await file.text();
        const parsed = parseRawFileContent(file.name, content, file.size);
        results.push(parsed);
      }

      // Load existing active DB records for duplicate checking
      const existingDb = await StorageService.getAccounts({ pageSize: 5000 });
      analyzeBatchRecords(results, existingDb.accounts);

      onParsedResults(results);
      showToast(`Parsed ${files.length} file(s) successfully`, 'success');
    } catch (err: any) {
      showToast(`Import parsing error: ${err?.message || 'Failed to read files'}`, 'error');
    } finally {
      setParsing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // Quick generator for synthetic sample files to test all required formats
  const loadSyntheticDemoBatch = async () => {
    setParsing(true);
    try {
      // 1. JSON Array format
      const arrayJson = JSON.stringify([
        {
          mobile: '9033807401', // prompt example
          phone: '9033807401',
          user_id: 'usr_meesho_demo_01',
          xo: 'token_array_9033807401',
          instance_id: 'inst_android_01',
          identity: { device: 'Redmi Note 11' },
        },
        {
          mobile: '9845012345',
          phone: '9845012345',
          user_id: 'usr_meesho_demo_02',
          xo: 'token_array_9845012345',
          instance_id: 'inst_android_02',
        },
      ], null, 2);

      // 2. TXT file containing MULTIPLE PRETTY-PRINTED CONSECUTIVE JSON OBJECTS (Critical requirement)
      const consecutiveTxt = `
{
  "mobile": "9820192831",
  "user_id": "usr_meesho_demo_03",
  "xo": "token_txt_consec_01",
  "ox": "ox_refresh_01",
  "instance_id": "inst_txt_device_01",
  "identity": {
    "app_version": "14.9.2",
    "os": "Android 13"
  }
}

{
  "mobile": "9123456789",
  "user_id": "usr_meesho_demo_04",
  "xo": "token_txt_consec_02",
  "ox": "ox_refresh_02",
  "instance_id": "inst_txt_device_02",
  "gaid": "58100000-8cf0-11bd-b23e-30d76e40000f"
}

{
  "phone": "+919712345678",
  "user_id": "usr_meesho_demo_05",
  "xo": "token_txt_consec_03",
  "identity": { "locale": "en_IN" }
}
`;

      // 3. JSONL / NDJSON format
      const jsonl = `{"mobile":"9988776655","user_id":"usr_demo_ndjson_1","instance_id":"inst_01"}
{"mobile":"9988776655","user_id":"usr_conflicting_id","instance_id":"inst_conflict"}
{"mobile":"9345678901","user_id":"usr_demo_ndjson_2","instance_id":"inst_02"}`;

      const res1 = parseRawFileContent('demo_array_accounts.json', arrayJson, arrayJson.length);
      const res2 = parseRawFileContent('demo_consecutive_pretty.txt', consecutiveTxt, consecutiveTxt.length);
      const res3 = parseRawFileContent('demo_records.jsonl', jsonl, jsonl.length);

      const combinedResults = [res1, res2, res3];

      const existingDb = await StorageService.getAccounts({ pageSize: 5000 });
      analyzeBatchRecords(combinedResults, existingDb.accounts);

      onParsedResults(combinedResults);
      showToast('Loaded 3 test files (JSON array, consecutive pretty-printed TXT, JSONL)', 'success');
    } finally {
      setParsing(false);
    }
  };

  const [importMode, setImportMode] = useState<'upload' | 'paste'>('upload');
  const [pasteContent, setPasteContent] = useState('');

  const handlePasteParse = async () => {
    const trimmed = pasteContent.trim();
    if (!trimmed) {
      showToast('Please paste a JSON session first', 'error');
      return;
    }
    setParsing(true);
    try {
      const parsed = parseRawFileContent('pasted_session.json', trimmed, trimmed.length);
      const existingDb = await StorageService.getAccounts({ pageSize: 5000 });
      analyzeBatchRecords([parsed], existingDb.accounts);

      onParsedResults([parsed]);
      showToast(`Parsed JSON session with ${parsed.valid_records} valid account(s)`, 'success');
    } catch (err: any) {
      showToast(`Parse error: ${err?.message || 'Invalid JSON format'}`, 'error');
    } finally {
      setParsing(false);
    }
  };

  const loadSingleSampleSession = () => {
    const sample = JSON.stringify({
      mobile: "9033807401",
      phone: "9033807401",
      user_id: "usr_meesho_demo_single",
      xo: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_session_token_single",
      ox: "ox_refresh_token_single",
      instance_id: "inst_android_redmi_11",
      identity: {
        device: "Redmi Note 11",
        locale: "en_IN",
        app_version: "15.2.1"
      }
    }, null, 2);
    setPasteContent(sample);
  };

  return (
    <div className="space-y-4">
      {/* Mode Switcher Tabs */}
      <div className="flex border-b border-slate-800 gap-3">
        <button
          type="button"
          onClick={() => setImportMode('upload')}
          className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            importMode === 'upload'
              ? 'border-pink-500 text-pink-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <UploadCloud className="w-4 h-4" />
          <span>Upload File(s)</span>
        </button>
        <button
          type="button"
          onClick={() => setImportMode('paste')}
          className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            importMode === 'paste'
              ? 'border-pink-500 text-pink-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>Paste JSON Session</span>
        </button>
      </div>

      {importMode === 'upload' ? (
        <>
          {/* Drop Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all flex flex-col items-center justify-center ${
              isDragging
                ? 'border-pink-500 bg-pink-950/20 scale-[0.99]'
                : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/80'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".json,.txt,.jsonl,.ndjson"
              onChange={e => handleFiles(e.target.files)}
              className="hidden"
            />

            <div className="w-16 h-16 rounded-2xl bg-pink-950/80 border border-pink-700/60 flex items-center justify-center mb-4 text-pink-400 shadow-lg shadow-pink-950/50">
              {parsing ? (
                <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <UploadCloud className="w-8 h-8" />
              )}
            </div>

            <h3 className="text-base sm:text-lg font-semibold text-slate-100">
              {parsing ? 'Parsing Uploaded Files...' : 'Drop Multiple JSON or TXT Files Here'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-md">
              Supports <code className="text-pink-300">.json</code>,{' '}
              <code className="text-pink-300">.txt</code>,{' '}
              <code className="text-pink-300">.jsonl</code>, and{' '}
              <code className="text-pink-300">.ndjson</code>. Drag or click to select multiple files in one batch.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <FileCode className="w-3.5 h-3.5" />
                JSON Arrays & Objects
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                Consecutive Pretty-Printed TXT
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <FileCode className="w-3.5 h-3.5" />
                JSONL / NDJSON
              </span>
            </div>
          </div>

          {/* Synthetic Demo Batch Loader */}
          <div className="flex items-center justify-between p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-pink-400 shrink-0" />
              <div className="text-xs">
                <span className="font-semibold text-slate-200">Need test files?</span>
                <span className="text-slate-400 ml-1.5 hidden sm:inline">
                  Generate sample multi-file batch (JSON array, pretty TXT, NDJSON).
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={loadSyntheticDemoBatch}
              disabled={parsing}
              className="px-3 py-1.5 bg-pink-950/80 hover:bg-pink-900/80 text-pink-300 border border-pink-700/60 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              Load Sample Files
            </button>
          </div>
        </>
      ) : (
        /* Paste Mode Area */
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-pink-400" />
                <span>Paste Account JSON Session</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Paste raw session object, JSON array, or pretty-printed account details.
              </p>
            </div>
            <button
              type="button"
              onClick={loadSingleSampleSession}
              className="text-xs text-pink-400 hover:text-pink-300 underline font-medium cursor-pointer"
            >
              Paste Sample Session
            </button>
          </div>

          <textarea
            value={pasteContent}
            onChange={e => setPasteContent(e.target.value)}
            rows={10}
            placeholder={`{\n  "mobile": "9033807401",\n  "xo": "jwt_session_token...",\n  "instance_id": "inst_12345"\n}`}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-pink-200 focus:outline-none focus:ring-1 focus:ring-pink-500 leading-relaxed resize-y"
          />

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-slate-500">
              {pasteContent.length > 0 ? `${pasteContent.length} characters` : 'No JSON entered'}
            </span>

            <button
              type="button"
              onClick={handlePasteParse}
              disabled={parsing || !pasteContent.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-pink-950/50 cursor-pointer"
            >
              {parsing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Parsing Session...</span>
                </>
              ) : (
                <>
                  <FileCode className="w-4 h-4" />
                  <span>Parse JSON Session</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
