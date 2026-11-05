import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { StorageService } from '../lib/storageAdapter';
import { AccountRecord, OrderRecord, AuditLogRecord } from '../types';
import {
  Users,
  ShoppingBag,
  RotateCcw,
  AlertTriangle,
  UploadCloud,
  FileCheck,
  Truck,
  XCircle,
  Clock,
  ArrowUpRight,
  TrendingUp,
} from 'lucide-react';

export const DashboardOverview: React.FC = () => {
  const { setActiveTab, dataVersion } = useApp();

  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [archivedAccounts, setArchivedAccounts] = useState<AccountRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      StorageService.getAccounts({ includeArchived: false, pageSize: 5000 }),
      StorageService.getAccounts({ onlyArchived: true, pageSize: 5000 }),
      StorageService.getOrders(),
      StorageService.getAuditLogs(10),
    ]).then(([accRes, archRes, ordRes, logsRes]) => {
      if (isMounted) {
        setAccounts(accRes.accounts);
        setArchivedAccounts(archRes.accounts);
        setOrders(ordRes);
        setAuditLogs(logsRes);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [dataVersion]);

  // Derived metrics
  const totalAccounts = accounts.length;
  const reviewRequired = accounts.filter(a => a.record_status === 'review_required').length;
  const conflictAccounts = accounts.filter(a => a.record_status === 'conflict').length;
  const totalArchived = archivedAccounts.length;

  const totalOrders = orders.length;
  const awaitingDelivery = orders.filter(o => ['placed', 'confirmed', 'shipped', 'out_for_delivery'].includes(o.delivery_status)).length;
  const cancelledOrders = orders.filter(o => o.delivery_status === 'cancelled' || o.cancellation_status === 'cancelled').length;
  const pendingRefunds = orders.filter(o => o.refund_status === 'pending' || o.refund_status === 'processing').length;
  const completedRefunds = orders.filter(o => o.refund_status === 'refunded').length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-pink-950/30 to-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
            Meesho Operations Overview
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Real-time account lifecycle, multi-file imports, order tracking, and refund resolution.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('imports')}
            className="flex items-center gap-2 px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-xl text-xs font-semibold shadow-lg shadow-pink-950/50 transition-all cursor-pointer"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Import Accounts</span>
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
          >
            <Users className="w-4 h-4 text-pink-400" />
            <span>View Accounts</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Accounts */}
        <div
          onClick={() => setActiveTab('accounts')}
          className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 p-5 rounded-2xl transition-all cursor-pointer shadow-lg group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Active Accounts
            </span>
            <div className="p-2.5 rounded-xl bg-pink-950/60 border border-pink-700/50 text-pink-400 group-hover:scale-110 transition-transform">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-100 font-mono">
              {loading ? '...' : totalAccounts}
            </span>
            <span className="text-xs text-pink-400 font-medium flex items-center">
              <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
              Verified Unique
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Main table displays mobile numbers only
          </p>
        </div>

        {/* Orders Awaiting Delivery */}
        <div
          onClick={() => setActiveTab('orders')}
          className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 p-5 rounded-2xl transition-all cursor-pointer shadow-lg group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              In Delivery Transit
            </span>
            <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-700/50 text-amber-400 group-hover:scale-110 transition-transform">
              <Truck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-300 font-mono">
              {loading ? '...' : awaitingDelivery}
            </span>
            <span className="text-xs text-slate-400">/ {totalOrders} total orders</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Shipped & out for delivery orders
          </p>
        </div>

        {/* Pending Refunds */}
        <div
          onClick={() => setActiveTab('returns')}
          className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 p-5 rounded-2xl transition-all cursor-pointer shadow-lg group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Pending Refunds
            </span>
            <div className="p-2.5 rounded-xl bg-cyan-950/60 border border-cyan-700/50 text-cyan-400 group-hover:scale-110 transition-transform">
              <RotateCcw className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-cyan-300 font-mono">
              {loading ? '...' : pendingRefunds}
            </span>
            <span className="text-xs text-emerald-400 font-medium">
              ({completedRefunds} completed)
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Follow-ups & bank reversals tracking
          </p>
        </div>

        {/* Quality & Conflicts */}
        <div
          onClick={() => setActiveTab('data_quality')}
          className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 p-5 rounded-2xl transition-all cursor-pointer shadow-lg group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Attention Required
            </span>
            <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-700/50 text-rose-400 group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-rose-300 font-mono">
              {loading ? '...' : reviewRequired + conflictAccounts}
            </span>
            <span className="text-xs text-rose-400">
              {conflictAccounts > 0 ? `${conflictAccounts} conflicts` : 'Review needed'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Accounts requiring data validation
          </p>
        </div>
      </div>

      {/* Secondary Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 block">Total Orders Processed</span>
          <span className="text-lg font-bold font-mono text-slate-200">{totalOrders}</span>
        </div>
        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 block">Cancelled Orders</span>
          <span className="text-lg font-bold font-mono text-slate-200">{cancelledOrders}</span>
        </div>
        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 block">Archived Accounts</span>
          <span className="text-lg font-bold font-mono text-slate-200">{totalArchived}</span>
        </div>
        <div className="p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl">
          <span className="text-[11px] text-slate-500 block">Database Security</span>
          <span className="text-sm font-semibold text-emerald-400">PostgreSQL RLS</span>
        </div>
      </div>

      {/* Recent Activity & Quick Navigation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Audit Logs */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-pink-400" />
              <h3 className="text-sm font-semibold text-slate-200">Recent Operational Activity</h3>
            </div>
            <button
              onClick={() => setActiveTab('audit')}
              className="text-xs text-pink-400 hover:text-pink-300 font-medium flex items-center gap-1 cursor-pointer"
            >
              <span>View Full Audit Log</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-800/80">
            {auditLogs.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No recent activity recorded</p>
            ) : (
              auditLogs.slice(0, 5).map(log => (
                <div key={log.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                  <div>
                    <span className="font-mono font-semibold text-slate-300">{log.action}</span>
                    <span className="text-slate-500 ml-2">({log.entity_type})</span>
                    {log.change_summary?.phone && (
                      <p className="font-mono text-pink-400 mt-0.5">{log.change_summary.phone}</p>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-slate-500 shrink-0">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Tools Panel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Enterprise Tools</h3>
            <div className="space-y-2">
              <button
                onClick={() => setActiveTab('reconciliation')}
                className="w-full p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left text-xs transition-colors flex items-center justify-between cursor-pointer"
              >
                <div>
                  <p className="font-semibold text-slate-300">CSV Reconciliation</p>
                  <p className="text-[11px] text-slate-500">Compare external CSV with database</p>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => setActiveTab('exports')}
                className="w-full p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left text-xs transition-colors flex items-center justify-between cursor-pointer"
              >
                <div>
                  <p className="font-semibold text-slate-300">Export Center</p>
                  <p className="text-[11px] text-slate-500">JSON arrays, CSV, separate files (No ZIP)</p>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => setActiveTab('recycle_bin')}
                className="w-full p-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-800/80 rounded-xl text-left text-xs transition-colors flex items-center justify-between cursor-pointer"
              >
                <div>
                  <p className="font-semibold text-slate-300">Recycle Bin</p>
                  <p className="text-[11px] text-slate-500">Recover or restore archived accounts</p>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Security Compliance</span>
            <span className="font-mono text-emerald-400">Strict Auth Enforced</span>
          </div>
        </div>
      </div>
    </div>
  );
};
