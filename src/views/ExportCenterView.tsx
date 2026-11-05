import React, { useState, useEffect } from 'react';
import { AccountRecord, OrderRecord } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import {
  exportAccountsCombinedJson,
  exportAccountsJsonLines,
  exportAccountsTxtSeparated,
  exportAccountsCsv,
  exportOrdersCsv,
  exportTodaysOrdersPlacedSheet,
  exportTodaysDeliveredOrdersSheet,
  isSameDayAsToday,
  getOrderPlacementDate,
  getOrderDeliveryDate,
  getAppTimezone,
  downloadAllIndividualFiles,
} from '../lib/exportUtils';
import {
  DownloadCloud,
  FileJson,
  FileText,
  FileSpreadsheet,
  FileCode,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Unlock,
  Truck,
  PackageCheck,
  ShoppingBag,
  Calendar,
} from 'lucide-react';

export const ExportCenterView: React.FC = () => {
  const { canViewSensitiveTokens, requestSensitiveAuthorization } = useAuth();
  const { showToast, dataVersion } = useApp();

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [includeSensitive, setIncludeSensitive] = useState<boolean>(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null);

  const placedTodayCount = new Set(
    orders.filter(o => isSameDayAsToday(getOrderPlacementDate(o))).map(o => o.id)
  ).size;
  const deliveredTodayCount = new Set(
    orders
      .filter(o => o.delivery_status === 'delivered' && isSameDayAsToday(getOrderDeliveryDate(o)))
      .map(o => o.id)
  ).size;

  useEffect(() => {
    StorageService.getAccounts({ includeArchived: false, pageSize: 5000 }).then(res => {
      setAccounts(res.accounts);
    });
    StorageService.getOrders().then(ord => {
      setOrders(ord);
    });
  }, [dataVersion]);

  const handleAuthorizeSensitiveToggle = async () => {
    if (!includeSensitive) {
      const ok = await requestSensitiveAuthorization();
      if (ok) {
        setIncludeSensitive(true);
        showToast('Authorized: full authentication credentials will be included in exports', 'info');
      } else {
        showToast('Authorization denied. Admin role required.', 'error');
      }
    } else {
      setIncludeSensitive(false);
    }
  };

  const handleDownloadAllIndividual = async () => {
    if (accounts.length === 0) return;
    setIsDownloadingAll(true);
    setDownloadProgress({ done: 0, total: accounts.length });

    try {
      showToast('Initiating individual file downloads (strictly NO archive)...', 'info');
      await downloadAllIndividualFiles(accounts, (done, total) => {
        setDownloadProgress({ done, total });
      });
      showToast(`Finished downloading ${accounts.length} individual .json files`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Download error', 'error');
    } finally {
      setIsDownloadingAll(false);
      setDownloadProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <DownloadCloud className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">Enterprise Export Center</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Export verified account records and order datasets in industry standard raw formats.
          </p>
        </div>

        {/* Action Controls & Indicators */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Configured Timezone */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs text-slate-300">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            <span>Timezone:</span>
            <span className="font-mono text-emerald-400 font-semibold">{getAppTimezone()}</span>
          </div>

          {/* Sensitive credentials toggle */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-2 rounded-xl text-xs">
            {includeSensitive ? (
              <Unlock className="w-4 h-4 text-amber-400" />
            ) : (
              <Lock className="w-4 h-4 text-emerald-400" />
            )}
            <span className="text-slate-300">
              {includeSensitive ? 'Including Sensitive Tokens' : 'Safe Mode (Tokens Masked)'}
            </span>
            <button
              onClick={handleAuthorizeSensitiveToggle}
              className={`px-2.5 py-1 rounded-lg font-medium text-[11px] transition-colors cursor-pointer ${
                includeSensitive
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {includeSensitive ? 'Switch to Safe' : 'Authorize Full'}
            </button>
          </div>
        </div>
      </div>

      {/* STRICT NO-ARCHIVE COMPLIANCE DECLARATION */}
      <div className="bg-emerald-950/20 border border-emerald-700/50 p-4 rounded-xl flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-200/90 leading-relaxed">
          <strong className="text-emerald-300 font-semibold">Strict No-Archive Guarantee:</strong> In
          full compliance with enterprise architecture requirements, this system never generates,
          downloads, or packages ZIP, TAR, RAR, or any archive files. All combined exports are direct
          data files, and individual files remain distinct standalone .json documents.
        </div>
      </div>

      {/* Export Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* 1. Combined JSON Array */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="w-10 h-10 rounded-xl bg-pink-950/80 border border-pink-700/60 flex items-center justify-center text-pink-400 mb-3">
              <FileJson className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">Combined JSON Array</h3>
            <p className="text-xs text-slate-400 mt-1">
              Exports all {accounts.length} active account objects wrapped in a single JSON array (
              <code>.json</code>).
            </p>
          </div>
          <button
            onClick={() => {
              exportAccountsCombinedJson(accounts, includeSensitive);
              showToast('Exported Combined JSON', 'success');
            }}
            disabled={accounts.length === 0}
            className="mt-4 w-full py-2 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Download .json Array
          </button>
        </div>

        {/* 2. JSON Lines / NDJSON */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-700/60 flex items-center justify-center text-cyan-400 mb-3">
              <FileCode className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">JSON Lines (NDJSON)</h3>
            <p className="text-xs text-slate-400 mt-1">
              One complete JSON account object per newline (<code>.jsonl</code>). Optimal for streaming
              data pipelines.
            </p>
          </div>
          <button
            onClick={() => {
              exportAccountsJsonLines(accounts, includeSensitive);
              showToast('Exported JSON Lines', 'success');
            }}
            disabled={accounts.length === 0}
            className="mt-4 w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Download .jsonl
          </button>
        </div>

        {/* 3. Separated TXT Objects */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-700/60 flex items-center justify-center text-amber-400 mb-3">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">Separated TXT Objects</h3>
            <p className="text-xs text-slate-400 mt-1">
              Valid JSON objects clearly separated by delimiter lines in a standard text file (
              <code>.txt</code>).
            </p>
          </div>
          <button
            onClick={() => {
              exportAccountsTxtSeparated(accounts, includeSensitive);
              showToast('Exported Separated TXT', 'success');
            }}
            disabled={accounts.length === 0}
            className="mt-4 w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Download .txt Data File
          </button>
        </div>

        {/* 4. Metadata CSV */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-700/60 flex items-center justify-center text-emerald-400 mb-3">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">Accounts Metadata CSV</h3>
            <p className="text-xs text-slate-400 mt-1">
              Tabular spreadsheet of account IDs, normalized numbers, statuses, tags, and timestamps.
            </p>
          </div>
          <button
            onClick={() => {
              exportAccountsCsv(accounts);
              showToast('Exported Accounts CSV', 'success');
            }}
            disabled={accounts.length === 0}
            className="mt-4 w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Download Accounts .csv
          </button>
        </div>

        {/* 5. Orders & Refunds CSV */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="w-10 h-10 rounded-xl bg-indigo-950/80 border border-indigo-700/60 flex items-center justify-center text-indigo-400 mb-3">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">Orders & Refunds CSV</h3>
            <p className="text-xs text-slate-400 mt-1">
              Complete tabular export of {orders.length} orders, tracking references, and refund balances.
            </p>
          </div>
          <button
            onClick={() => {
              exportOrdersCsv(orders);
              showToast('Exported Orders CSV', 'success');
            }}
            disabled={orders.length === 0}
            className="mt-4 w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Download Orders .csv
          </button>
        </div>

        {/* 6. Download All Individual Files */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg">
          <div>
            <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-700/60 flex items-center justify-center text-purple-400 mb-3">
              <DownloadCloud className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">Download All Individual Files</h3>
            <p className="text-xs text-slate-400 mt-1">
              Triggers separate browser downloads for each account as its own standalone file (e.g.{' '}
              <code>account_9033807401.json</code>).
            </p>
          </div>
          <button
            onClick={handleDownloadAllIndividual}
            disabled={isDownloadingAll || accounts.length === 0}
            className="mt-4 w-full py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            {isDownloadingAll
              ? `Downloading ${downloadProgress?.done}/${downloadProgress?.total}...`
              : 'Trigger Separate Downloads'}
          </button>
        </div>

        {/* 7. Option A: Today's Orders Placed Sheet */}
        <div className="bg-slate-900 border border-sky-500/30 p-5 rounded-2xl flex flex-col justify-between hover:border-sky-500/60 transition-all shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-sky-600/20 text-sky-300 text-[10px] font-bold px-2.5 py-0.5 rounded-bl-lg uppercase tracking-wider border-b border-l border-sky-500/30">
            Placement Date
          </div>
          <div>
            <div className="w-10 h-10 rounded-xl bg-sky-950/80 border border-sky-500/60 flex items-center justify-center text-sky-400 mb-3">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              Today's Orders Placed Sheet
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Export all orders placed today, regardless of current delivery status (pending, processing, shipped, delivered, or cancelled). Filters strictly by order placement date.
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-sky-300/90 font-mono">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span>
              <span>{placedTodayCount} order{placedTodayCount === 1 ? '' : 's'} placed today</span>
            </div>
          </div>
          <button
            onClick={() => {
              const count = exportTodaysOrdersPlacedSheet(orders, accounts);
              showToast(
                count > 0
                  ? `Exported Today's Orders Placed Sheet (${count} orders)`
                  : `Exported Today's Orders Placed Sheet (0 orders placed today)`,
                'success'
              );
            }}
            disabled={orders.length === 0}
            className="mt-4 w-full py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm shadow-sky-900/30"
          >
            <PackageCheck className="w-3.5 h-3.5" />
            <span>Download Placed Sheet (.csv)</span>
          </button>
        </div>

        {/* 8. Option B: Today's Successfully Delivered Orders Sheet */}
        <div className="bg-slate-900 border border-emerald-500/30 p-5 rounded-2xl flex flex-col justify-between hover:border-emerald-500/60 transition-all shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-emerald-600/20 text-emerald-300 text-[10px] font-bold px-2.5 py-0.5 rounded-bl-lg uppercase tracking-wider border-b border-l border-emerald-500/30">
            Status Transition Date
          </div>
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-500/60 flex items-center justify-center text-emerald-400 mb-3">
              <Truck className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              Today's Successfully Delivered Orders Sheet
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Export only orders whose delivery status changed to Delivered today based on actual status change timestamp (<span className="text-emerald-400 font-mono font-medium">{getAppTimezone()}</span>). Excludes pending, placed, processing, cancelled, returned, and previously delivered orders.
            </p>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-300/90 font-mono">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>{deliveredTodayCount} order{deliveredTodayCount === 1 ? '' : 's'} transitioned to delivered today</span>
            </div>
          </div>
          <button
            onClick={() => {
              const count = exportTodaysDeliveredOrdersSheet(orders, accounts);
              showToast(
                count > 0
                  ? `Exported Today's Successfully Delivered Orders Sheet (${count} orders)`
                  : `Exported Today's Delivered Sheet (0 orders became Delivered today)`,
                'success'
              );
            }}
            disabled={orders.length === 0}
            className="mt-4 w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-900/30"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Download Delivered Sheet (.csv)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
