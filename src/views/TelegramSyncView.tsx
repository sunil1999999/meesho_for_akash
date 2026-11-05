import React, { useState, useEffect, useRef } from 'react';
import { AccountRecord, OrderRecord, WorkerHeartbeatRecord } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { TelegramBotModal } from '../components/telegram/TelegramBotModal';
import { useApp } from '../context/AppContext';
import { Badge } from '../components/common/Badge';
import {
  Send,
  Play,
  Square,
  RotateCcw,
  CheckCircle2,
  Clock,
  ShoppingBag,
  ExternalLink,
  ShieldCheck,
  Search,
  Key,
  Terminal,
  Settings,
  Check,
  AlertCircle,
  Save,
  Copy,
  Activity,
  Zap,
  Ban,
  Radio,
  FileText,
  AlertTriangle,
  RefreshCw,
  ShoppingCart,
} from 'lucide-react';

export const TelegramSyncView: React.FC = () => {
  const { dataVersion, setActiveTab, showToast } = useApp();

  // Mode: Continuous Monitor vs Manual Single Account
  const [activeMode, setActiveMode] = useState<'continuous' | 'manual'>('continuous');

  // Core Data
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [extractedOrders, setExtractedOrders] = useState<OrderRecord[]>([]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Worker Monitor State
  const [workerRunning, setWorkerRunning] = useState<boolean>(false);
  const [workerPid, setWorkerPid] = useState<number | null>(null);
  const [workerLogs, setWorkerLogs] = useState<string[]>([]);
  const [latestHeartbeat, setLatestHeartbeat] = useState<WorkerHeartbeatRecord | null>(null);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [monitorSubTab, setMonitorSubTab] = useState<'accounts' | 'orders' | 'logs'>('accounts');
  const [orderFilter, setOrderFilter] = useState<'all' | 'terminal' | 'active'>('all');

  // Telegram MTProto Credentials State
  const [credStatus, setCredStatus] = useState<{
    configured: boolean;
    api_id: string | null;
    api_hash: string | null;
    has_session: boolean;
    bot_username: string;
  } | null>(null);

  const [showCredForm, setShowCredForm] = useState<boolean>(false);
  const [savingCreds, setSavingCreds] = useState<boolean>(false);
  const [copiedHelperCmd, setCopiedHelperCmd] = useState<boolean>(false);

  const [credentials, setCredentials] = useState({
    api_id: '',
    api_hash: '',
    string_session: '',
  });

  const logsEndRef = useRef<HTMLDivElement>(null);

  const checkCredStatus = async () => {
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = await res.json();
        setCredStatus(data);
      }
    } catch {}
  };

  const checkWorkerStatus = async () => {
    try {
      const res = await fetch('/api/telegram/monitor-status');
      if (res.ok) {
        const data = await res.json();
        setWorkerRunning(data.is_running);
        setWorkerPid(data.pid);
        if (data.recent_logs && data.recent_logs.length > 0) {
          setWorkerLogs(data.recent_logs);
        }
      }
      const beats = await StorageService.getLatestWorkerHeartbeats(1);
      if (beats && beats.length > 0) {
        setLatestHeartbeat(beats[0]);
      }
    } catch {}
  };

  const handleStartMonitor = async () => {
    setIsActionLoading(true);
    try {
      const res = await fetch('/api/telegram/monitor-start', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setWorkerRunning(true);
        setWorkerPid(data.pid);
        showToast(data.message || 'Continuous order monitor started!', 'success');

        // Check after startup delay to confirm worker did not crash on init
        setTimeout(async () => {
          try {
            const statusRes = await fetch('/api/telegram/monitor-status');
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              setWorkerRunning(statusData.is_running);
              setWorkerPid(statusData.pid);
              if (statusData.recent_logs && statusData.recent_logs.length > 0) {
                setWorkerLogs(statusData.recent_logs);
              }
              if (!statusData.is_running) {
                const lastErr = statusData.recent_logs?.slice(-2).join(' ') || 'Process exited unexpectedly';
                showToast(`Worker halted: ${lastErr}`, 'error');
                setMonitorSubTab('logs');
              }
            }
          } catch {}
        }, 1200);
      } else {
        showToast(data.error || 'Failed to start monitor', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Error starting background monitor', 'error');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleStopMonitor = async () => {
    setIsActionLoading(true);
    try {
      const res = await fetch('/api/telegram/monitor-stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Continuous monitor stopped gracefully', 'info');
        setWorkerRunning(false);
        setWorkerPid(null);
        checkWorkerStatus();
      } else {
        showToast(data.error || 'Failed to stop monitor', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Error stopping monitor', 'error');
    } finally {
      setIsActionLoading(false);
    }
  };

  useEffect(() => {
    checkCredStatus();
    checkWorkerStatus();

    // Auto-refresh worker status and heartbeats every 4 seconds
    const interval = setInterval(() => {
      checkWorkerStatus();
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accRes, ordRes] = await Promise.all([
        StorageService.getAccounts({ includeArchived: false, pageSize: 5000 }),
        StorageService.getOrders(),
      ]);

      setAccounts(accRes.accounts);
      if (accRes.accounts.length > 0 && !selectedAccountId) {
        setSelectedAccountId(accRes.accounts[0].id);
      }

      // Filter orders linked to verified API or with Telegram notes
      const tgOrders = ordRes.filter(
        o => o.data_source === 'verified_api' || (o.notes && o.notes.includes('Telegram')) || o.is_terminal
      );
      setExtractedOrders(tgOrders);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [dataVersion]);

  useEffect(() => {
    if (monitorSubTab === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [workerLogs, monitorSubTab]);

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) || accounts[0] || null;

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCreds(true);
    try {
      const res = await fetch('/api/telegram/save-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Telegram credentials saved to .env successfully!', 'success');
        setShowCredForm(false);
        checkCredStatus();
      } else {
        showToast(data.error || 'Failed to save credentials', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Network error while saving credentials', 'error');
    } finally {
      setSavingCreds(false);
    }
  };

  const copyHelperCommand = () => {
    navigator.clipboard.writeText('python generate_telegram_session.py');
    setCopiedHelperCmd(true);
    showToast('Command copied: python generate_telegram_session.py', 'info');
    setTimeout(() => setCopiedHelperCmd(false), 2000);
  };

  // Metric computations
  const terminalOrders = extractedOrders.filter(o => o.is_terminal);
  const activeOrders = extractedOrders.filter(o => !o.is_terminal);
  const soldAccounts = accounts.filter(a => a.record_status === 'sold' || a.monitoring_status === 'sold_excluded');
  const totalPermanentlyExcluded = terminalOrders.length + soldAccounts.length;
  const emptyAccounts = accounts.filter(a => a.monitoring_status === 'no_orders_found');
  const addedToCartAccounts = accounts.filter(a => a.monitoring_status === 'added_to_cart');
  const accountsWithOrders = accounts.filter(a => (a.total_orders_discovered ?? 0) > 0 || a.monitoring_status === 'has_orders');
  const attentionAccounts = accounts.filter(a => a.requires_attention);

  const filteredOrders = extractedOrders.filter(o => {
    if (orderFilter === 'terminal') return o.is_terminal;
    if (orderFilter === 'active') return !o.is_terminal;
    return true;
  });

  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-pink-950/20 to-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl sm:text-2xl font-bold text-slate-100">
              Meesho Automated Account & Order Monitor
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-3xl leading-relaxed">
            Continuous autonomous background engine for `@primes_meesho_bot`. Discovers orders, auto-refreshes expired session tokens, permanently excludes delivered/cancelled orders from future polling, and schedules rechecks for empty accounts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center">
            <button
              onClick={() => setActiveMode('continuous')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeMode === 'continuous'
                  ? 'bg-pink-700 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Continuous Monitor</span>
            </button>
            <button
              onClick={() => setActiveMode('manual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeMode === 'manual'
                  ? 'bg-pink-700 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Single Account</span>
            </button>
          </div>

          <button
            onClick={() => setShowCredForm(!showCredForm)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium transition-colors cursor-pointer"
            title="Configure Telegram API credentials"
          >
            <Key className="w-3.5 h-3.5 text-pink-400" />
            <span className="hidden sm:inline">API Setup</span>
          </button>
        </div>
      </div>

      {/* Telegram MTProto Credentials Form (Collapsible) */}
      {showCredForm && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4 animate-in fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Key className="w-4 h-4 text-pink-400" />
              Telegram MTProto Automation Credentials
            </h3>
            <button
              onClick={() => setShowCredForm(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>

          <form
            onSubmit={handleSaveCredentials}
            className="pt-2 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs"
          >
            <div>
              <label className="block text-slate-400 font-semibold uppercase tracking-wider mb-1">
                TELEGRAM_API_ID
              </label>
              <input
                type="text"
                placeholder="e.g. 29381029"
                value={credentials.api_id}
                onChange={e => setCredentials(prev => ({ ...prev, api_id: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Obtain from https://my.telegram.org
              </span>
            </div>

            <div>
              <label className="block text-slate-400 font-semibold uppercase tracking-wider mb-1">
                TELEGRAM_API_HASH
              </label>
              <input
                type="text"
                placeholder="e.g. 9f8a2b3c4d5e6f7a8b9c..."
                value={credentials.api_hash}
                onChange={e => setCredentials(prev => ({ ...prev, api_hash: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                32-character hex API Hash
              </span>
            </div>

            <div>
              <label className="block text-slate-400 font-semibold uppercase tracking-wider mb-1">
                TELEGRAM_STRING_SESSION
              </label>
              <input
                type="password"
                placeholder="1BJWap1wBu..."
                value={credentials.string_session}
                onChange={e => setCredentials(prev => ({ ...prev, string_session: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Generated via Telethon session string
              </span>
            </div>

            <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2 text-slate-400 bg-slate-950 p-2 rounded-lg border border-slate-800">
                <Terminal className="w-3.5 h-3.5 text-pink-400" />
                <span className="text-[11px]">Generate string in terminal:</span>
                <code className="text-pink-300 font-mono text-[11px]">python generate_telegram_session.py</code>
                <button
                  type="button"
                  onClick={copyHelperCommand}
                  className="p-1 text-slate-400 hover:text-white rounded"
                  title="Copy command"
                >
                  {copiedHelperCmd ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={savingCreds}
                className="flex items-center gap-1.5 px-4 py-2 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingCreds ? 'Saving...' : 'Save Credentials to .env'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CONTINUOUS MONITOR MODE */}
      {activeMode === 'continuous' && (
        <div className="space-y-6">
          {/* Worker Controller Bar */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={`w-4 h-4 rounded-full flex-shrink-0 ${
                  workerRunning
                    ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50 animate-pulse'
                    : 'bg-slate-600'
                }`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-100">
                    Background Monitoring Daemon
                  </h3>
                  <Badge variant={workerRunning ? 'success' : 'neutral'} size="sm">
                    {workerRunning ? 'ACTIVE / RUNNING' : 'STOPPED'}
                  </Badge>
                  {workerPid && (
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      PID: {workerPid}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {latestHeartbeat ? (
                    <>
                      Last heartbeat: <strong className="text-slate-200">{formatRelativeTime(latestHeartbeat.last_heartbeat)}</strong> • Cycle #{latestHeartbeat.current_cycle} • Host: <span className="font-mono text-pink-300">{latestHeartbeat.metadata?.host || 'SEENU'}</span>
                    </>
                  ) : (
                    'Ready to start background continuous cycle.'
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={checkWorkerStatus}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                title="Refresh worker state"
              >
                <RefreshCw className="w-4 h-4" />
              </button>

              {workerRunning ? (
                <button
                  onClick={handleStopMonitor}
                  disabled={isActionLoading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-rose-950/50 transition-all cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>{isActionLoading ? 'Stopping...' : 'Stop Background Monitor'}</span>
                </button>
              ) : (
                <button
                  onClick={handleStartMonitor}
                  disabled={isActionLoading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-pink-950/50 transition-all cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isActionLoading ? 'Starting...' : 'Start Continuous Monitor'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Metric KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* 1. Accounts Monitored */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Accounts Monitored
              </span>
              <div className="text-2xl font-bold font-mono text-slate-100 mt-1">
                {accounts.length}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                {accountsWithOrders.length} with discovered orders
              </span>
            </div>

            {/* 2. Discovered Orders */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow">
              <span className="text-[11px] font-semibold text-pink-400 uppercase tracking-wider block">
                Orders Discovered
              </span>
              <div className="text-2xl font-bold font-mono text-pink-300 mt-1">
                {extractedOrders.length}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Verified from WebApp API
              </span>
            </div>

            {/* 3. Terminal & Sold Accounts Permanently Excluded */}
            <div className="bg-slate-900 border border-emerald-900/40 p-4 rounded-xl shadow relative overflow-hidden">
              <div className="absolute top-2 right-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400/60" />
              </div>
              <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider block">
                Permanent Excluded
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-300 mt-1">
                {totalPermanentlyExcluded}
              </div>
              <span className="text-[10px] text-emerald-500/80 mt-1 block">
                {terminalOrders.length} orders + {soldAccounts.length} sold accounts
              </span>
            </div>

            {/* 4. Active Orders Polling */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow">
              <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider block">
                Active Polling
              </span>
              <div className="text-2xl font-bold font-mono text-amber-300 mt-1">
                {activeOrders.length}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Monitored for state change
              </span>
            </div>

            {/* 5. Added to Cart (when no orders found) */}
            <div className="bg-slate-900 border border-sky-900/40 p-4 rounded-xl shadow">
              <span className="text-[11px] font-semibold text-sky-400 uppercase tracking-wider block">
                Added to Cart
              </span>
              <div className="text-2xl font-bold font-mono text-sky-300 mt-1">
                {addedToCartAccounts.length}
              </div>
              <span className="text-[10px] text-sky-500/80 mt-1 block">
                {addedToCartAccounts.length} in cart • {emptyAccounts.length} empty
              </span>
            </div>

            {/* 6. Attention Required */}
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow">
              <span className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider block">
                Needs Attention
              </span>
              <div className="text-2xl font-bold font-mono text-rose-300 mt-1">
                {attentionAccounts.length}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Authentication errors / failures
              </span>
            </div>
          </div>

          {/* Subtabs for Monitoring Engine */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMonitorSubTab('accounts')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    monitorSubTab === 'accounts'
                      ? 'bg-slate-800 text-white border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Accounts Monitoring Schedule ({accounts.length})
                </button>
                <button
                  onClick={() => setMonitorSubTab('orders')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    monitorSubTab === 'orders'
                      ? 'bg-slate-800 text-white border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Orders & Terminal Exclusions ({extractedOrders.length})
                </button>
                <button
                  onClick={() => setMonitorSubTab('logs')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                    monitorSubTab === 'logs'
                      ? 'bg-slate-800 text-white border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Terminal className="w-3 h-3 text-pink-400" />
                  <span>Daemon Console</span>
                  {workerRunning && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
                </button>
              </div>

              {monitorSubTab === 'orders' && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 uppercase font-semibold">Filter:</span>
                  <select
                    value={orderFilter}
                    onChange={e => setOrderFilter(e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="all">All ({extractedOrders.length})</option>
                    <option value="terminal">Permanently Excluded Terminal ({terminalOrders.length})</option>
                    <option value="active">Active Polling ({activeOrders.length})</option>
                  </select>
                </div>
              )}
            </div>

            {/* TAB 1: ACCOUNTS MONITORING SCHEDULE */}
            {monitorSubTab === 'accounts' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4">Mobile Number</th>
                      <th className="py-3 px-4">Monitoring Status</th>
                      <th className="py-3 px-4">Orders Found</th>
                      <th className="py-3 px-4">Last Checked</th>
                      <th className="py-3 px-4">Next Check Scheduled</th>
                      <th className="py-3 px-4">Session Health</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {accounts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          No accounts registered in Supabase.
                        </td>
                      </tr>
                    ) : (
                      accounts.map(acc => {
                        const status = acc.monitoring_status || 'pending';
                        const isSold = acc.record_status === 'sold' || status === 'sold_excluded';
                        const isAddedToCart = status === 'added_to_cart';
                        const isTerminalNoOrders = status === 'no_orders_found';
                        const hasOrders = status === 'has_orders' || (acc.total_orders_discovered ?? 0) > 0;
                        const needsAttention = acc.requires_attention;

                        return (
                          <tr key={acc.id} className="hover:bg-slate-800/40">
                            <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                              {acc.phone_display}
                            </td>
                            <td className="py-3 px-4">
                              {isSold ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-800/60">
                                  <Ban className="w-3 h-3 text-purple-400" />
                                  Permanently Excluded (Sold)
                                </span>
                              ) : isAddedToCart ? (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-950/80 text-sky-300 border border-sky-800/60">
                                  <ShoppingCart className="w-3 h-3 text-sky-400" />
                                  Added to Cart
                                </span>
                              ) : needsAttention ? (
                                <Badge variant="danger" size="sm">
                                  Attention Required
                                </Badge>
                              ) : hasOrders ? (
                                <Badge variant="success" size="sm">
                                  Has Orders ({acc.total_orders_discovered ?? 1})
                                </Badge>
                              ) : isTerminalNoOrders ? (
                                <Badge variant="info" size="sm">
                                  No Orders Placed Yet
                                </Badge>
                              ) : (
                                <Badge variant="warning" size="sm">
                                  Pending First Cycle
                                </Badge>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-slate-200">
                              {acc.total_orders_discovered ?? (hasOrders ? 1 : 0)}
                            </td>
                            <td className="py-3 px-4 text-slate-400">
                              {formatRelativeTime(acc.last_checked_at)}
                            </td>
                            <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                              {isSold ? 'Never (Account Sold)' : acc.next_check_at ? new Date(acc.next_check_at).toLocaleTimeString() : 'Immediate'}
                            </td>
                            <td className="py-3 px-4 text-slate-400">
                              {isSold ? (
                                <span className="text-purple-300 text-[11px] font-medium">Account Sold</span>
                              ) : isAddedToCart ? (
                                <span className="text-sky-300 text-[11px] flex items-center gap-1 font-medium">
                                  <ShoppingCart className="w-3 h-3" /> Kurti Pack in Cart
                                </span>
                              ) : acc.attention_reason ? (
                                <span className="text-rose-400 text-[11px]">{acc.attention_reason}</span>
                              ) : (
                                <span className="text-emerald-400 text-[11px] flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" /> Valid Session
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 2: ORDERS & TERMINAL EXCLUSIONS */}
            {monitorSubTab === 'orders' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4">Order ID</th>
                      <th className="py-3 px-4">Account Mobile</th>
                      <th className="py-3 px-4">Product Name</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Delivery Status</th>
                      <th className="py-3 px-4">Polling Exclusion Policy</th>
                      <th className="py-3 px-4">Terminal Confirmed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          No orders matching filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map(order => (
                        <tr key={order.id} className="hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono font-semibold text-slate-200">
                            {order.external_order_id || order.id}
                          </td>
                          <td className="py-3 px-4 font-mono text-pink-300">
                            {order.account_phone || 'Linked Account'}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-200 max-w-xs truncate">
                            {order.product_name}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-slate-100">
                            ₹{order.order_amount.toFixed(2)}
                          </td>
                          <td className="py-3 px-4">
                            <Badge
                              variant={
                                order.delivery_status === 'delivered'
                                  ? 'success'
                                  : order.delivery_status === 'cancelled'
                                  ? 'danger'
                                  : 'warning'
                              }
                              size="sm"
                            >
                              {order.delivery_status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            {order.monitoring_status === 'terminal_sold' ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-950/80 text-purple-300 border border-purple-800/60">
                                <Ban className="w-3 h-3 text-purple-400" />
                                Permanently Excluded (Sold)
                              </span>
                            ) : order.is_terminal ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                                <Ban className="w-3 h-3 text-emerald-400" />
                                Permanently Excluded
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60">
                                <RotateCcw className="w-3 h-3 text-amber-400 animate-spin" />
                                Active Polling
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                            {order.terminal_confirmed_at
                              ? new Date(order.terminal_confirmed_at).toLocaleDateString()
                              : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 3: DAEMON CONSOLE & LOGS */}
            {monitorSubTab === 'logs' && (
              <div className="p-4 bg-slate-950 font-mono text-xs text-slate-300 max-h-96 overflow-y-auto space-y-1">
                {workerLogs.length === 0 ? (
                  <div className="py-8 text-center text-slate-600">
                    No console logs yet. Start the continuous monitor daemon to view live events.
                  </div>
                ) : (
                  workerLogs.map((log, i) => (
                    <div
                      key={i}
                      className={`leading-relaxed ${
                        log.includes('Error') || log.includes('error') || log.includes('failed')
                          ? 'text-rose-400'
                          : log.includes('Terminal') || log.includes('delivered')
                          ? 'text-emerald-300'
                          : log.includes('Cycle')
                          ? 'text-pink-300 font-bold'
                          : 'text-slate-300'
                      }`}
                    >
                      {log}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* MANUAL SINGLE ACCOUNT MODE */}
      {activeMode === 'manual' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Account Selection */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-4">
              <h3 className="text-sm font-semibold text-slate-200">Select Account for Session Sync</h3>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Target Mobile Number
                </label>
                <select
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500"
                >
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.phone_display} ({acc.record_status})
                    </option>
                  ))}
                </select>
              </div>

              {selectedAccount && (
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Normalized Phone:</span>
                    <span className="font-mono text-slate-200 font-semibold">
                      {selectedAccount.phone_normalized}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status:</span>
                    <Badge variant={selectedAccount.record_status === 'active' ? 'success' : 'warning'}>
                      {selectedAccount.record_status}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Monitoring State:</span>
                    <span className="font-mono text-pink-300 font-semibold">
                      {selectedAccount.monitoring_status || 'pending'}
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={() => setIsModalOpen(true)}
                disabled={!selectedAccount}
                className="w-full py-2.5 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-md transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Launch Interactive Telegram Workflow</span>
              </button>
            </div>

            {/* Right: Mandatory Steps Tracker Card */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-pink-400" />
                  <span>Mandatory Step Execution Sequence</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1">
                    <span className="font-bold text-pink-400 font-mono">1. Open Bot & Start</span>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Opens `@primes_meesho_bot`, sends `/start`, waits for response, and clicks exact <strong>Import JSON Session</strong> button.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1">
                    <span className="font-bold text-pink-400 font-mono">2. Text Message Only</span>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Pastes complete JSON as text (never uploaded as a file). Validates length ≤ 4,096 chars and awaits confirmation.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1">
                    <span className="font-bold text-pink-400 font-mono">3. Restart & Open Shop</span>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Sends `/start` again, detects <strong>Open Shop</strong> button, clicks it, and confirms shop interface is loaded.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1">
                    <span className="font-bold text-pink-400 font-mono">4. Orders & Supabase Save</span>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Navigates to <strong>Orders</strong>, extracts all order details, checks uniqueness, and saves to Supabase with RLS.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
                <span>Security Standard</span>
                <span className="text-emerald-400 font-mono">Strict Confirmation Enforced</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for manual workflow */}
      <TelegramBotModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          loadData();
        }}
        account={selectedAccount}
      />
    </div>
  );
};
