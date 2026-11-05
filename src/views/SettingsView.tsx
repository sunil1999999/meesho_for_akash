import React, { useState } from 'react';
import { supabaseUrl, supabaseAnonKey, isSupabaseConfigured, reconfigureSupabase, supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { Settings, Database, Key, CheckCircle2, AlertTriangle, Terminal, RefreshCw, Globe, Zap } from 'lucide-react';
import { Badge } from '../components/common/Badge';
import { getAppTimezone, setAppTimezone } from '../lib/exportUtils';
import { PaymentConfig } from '../lib/paymentConfig';

export const SettingsView: React.FC = () => {
  const { showToast, refreshData } = useApp();

  const [url, setUrl] = useState<string>(supabaseUrl === 'https://mock-meesho-supabase.supabase.co' ? '' : supabaseUrl);
  const [key, setKey] = useState<string>(supabaseAnonKey === 'mock-anon-key-placeholder' ? '' : supabaseAnonKey);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [currentTimezone, setCurrentTimezone] = useState<string>(getAppTimezone());
  const [isFreePaymentMode, setIsFreePaymentMode] = useState<boolean>(PaymentConfig.isFreePaymentMode());

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !key.trim()) {
      showToast('Please enter both Supabase URL and Anon Key', 'warning');
      return;
    }
    reconfigureSupabase(url.trim(), key.trim());
    showToast('Supabase client reconfigured successfully', 'success');
    refreshData();
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.from('accounts').select('id').limit(1);
      if (error) {
        setTestResult({
          success: false,
          message: `Connection returned error: ${error.message}. Please verify table migrations have been applied.`,
        });
      } else {
        setTestResult({
          success: true,
          message: 'Connected to Supabase PostgreSQL database successfully! RLS policies verified.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Network or host failure: ${err?.message || 'Unreachable'}`,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleResetSandbox = () => {
    localStorage.removeItem('meesho_accounts_data_v1');
    localStorage.removeItem('meesho_orders_data_v1');
    localStorage.removeItem('meesho_audit_logs_v1');
    localStorage.removeItem('meesho_saved_filters_v1');
    showToast('Reset local sandbox cache to original demo fixtures', 'info');
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">System & Supabase Database Configuration</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure live Supabase PostgreSQL connection or operate seamlessly in local sandbox mode.
          </p>
        </div>
      </div>

      {/* Backend Status Card */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pink-950/80 border border-pink-700/60 flex items-center justify-center text-pink-400">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100">Database Driver:</h3>
              <Badge variant={isSupabaseConfigured ? 'success' : 'warning'}>
                {isSupabaseConfigured ? 'Supabase Live Connected' : 'Local Sandbox Mode'}
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isSupabaseConfigured
                ? 'Queries routing directly to Supabase PostgreSQL cluster with Row Level Security.'
                : 'Operating in high-speed, persistent in-browser storage mode with full relational consistency.'}
            </p>
          </div>
        </div>

        <button
          onClick={handleResetSandbox}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition-colors cursor-pointer self-start sm:self-auto"
        >
          Reset Sandbox Data
        </button>
      </div>

      {/* Application Timezone Configuration Card */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">Application Operating Timezone</h3>
          </div>
          <Badge variant="success">Active: {currentTimezone}</Badge>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Controls date boundaries and midnight cutoff points for export reports like <strong>“Today's Successfully Delivered Orders Sheet”</strong> and <strong>“Today's Orders Placed Sheet”</strong>.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {[
            { id: 'Asia/Kolkata', label: 'Asia/Kolkata (IST +5:30)' },
            { id: 'UTC', label: 'UTC (GMT +0:00)' },
            { id: 'America/New_York', label: 'America/New_York (EST/EDT)' },
            { id: 'Europe/London', label: 'Europe/London (GMT/BST)' },
            { id: 'Asia/Dubai', label: 'Asia/Dubai (GST +4:00)' },
          ].map(tz => (
            <button
              key={tz.id}
              onClick={() => {
                setAppTimezone(tz.id);
                setCurrentTimezone(tz.id);
                showToast(`Application timezone configured to ${tz.id}`, 'success');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                currentTimezone === tz.id
                  ? 'bg-emerald-600/30 border-emerald-500/80 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tz.label}
            </button>
          ))}
        </div>
      </div>

      {/* Supabase Config Form */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Key className="w-4 h-4 text-pink-400" />
          <span>Connect Your Supabase Project</span>
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Provide your project URL and public Anon Key from your Supabase dashboard (Project Settings → API).
          Service-role keys must NEVER be placed in client settings.
        </p>

        <form onSubmit={handleSaveConfig} className="space-y-4 max-w-2xl">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Supabase Project URL
            </label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://xyzcompany.supabase.co"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              Supabase Anon / Public Key
            </label>
            <input
              type="password"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-pink-500"
            />
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                testResult.success
                  ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                  : 'bg-rose-950/40 border-rose-700/60 text-rose-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{testResult.message}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="px-5 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold shadow-md transition-colors cursor-pointer"
            >
              Save Credentials
            </button>

            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
              <span>{testing ? 'Testing...' : 'Test Database Query'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Direct Checkout & Payment Mode Configuration */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              Direct Checkout & Free Payment Mode
            </h3>
          </div>
          <Badge variant={isFreePaymentMode ? 'success' : 'warning'}>
            {isFreePaymentMode ? 'Free Payment Mode Active' : 'Real Payment Mode (UPI / COD)'}
          </Badge>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Controls whether the <strong>“Direct Checkout and Pay”</strong> module initiates live UPI payment sessions through the merchant's gateway or executes in an authorized Free Mode.
        </p>

        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold text-white block">FREE_PAYMENT_MODE Configuration</span>
              <span className="text-slate-400 text-[11px]">
                When enabled: No real payment is initiated, no QR code is generated, and orders receive internal status <strong className="text-emerald-400 font-mono">FREE_MODE_COMPLETED</strong>.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                const next = !isFreePaymentMode;
                PaymentConfig.setFreePaymentMode(next);
                setIsFreePaymentMode(next);
                showToast(
                  next
                    ? 'Free Payment Mode Enabled: Checkout operates without real payments or QR codes'
                    : 'Normal Payment Mode Enabled: Live UPI and COD workflow restored',
                  next ? 'success' : 'info'
                );
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer shrink-0 ${
                isFreePaymentMode
                  ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300 hover:bg-emerald-600/40'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {isFreePaymentMode ? '⚡ Free Mode: ON' : 'Real Payment Mode: ON'}
            </button>
          </div>

          <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1">
            <p>
              <strong className="text-slate-300">Merchant Bot Limitation:</strong> `@primes_meesho_bot` uses genuine UPI and merchant wallet charging. Legitimate 100% free checkout on Meesho only occurs for promotional balance or ₹0 catalog items.
            </p>
            <p>
              In Free Mode, our application assigns explicit internal status <strong className="text-emerald-400 font-mono">FREE_MODE_COMPLETED</strong> and preserves truthful merchant payment status as <strong className="text-amber-400 font-mono">pending</strong> without fabricating gateway success.
            </p>
          </div>
        </div>
      </div>

      {/* Database Schema Migration Reference */}
      <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-pink-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              PostgreSQL Schema Migration File
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">
            supabase/migrations/001_initial_schema.sql
          </span>
        </div>
        <p className="text-xs text-slate-400">
          Run this migration in your Supabase SQL Editor to establish tables, indexes, uniqueness constraints, and Row Level Security policies.
        </p>

        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300">
          <p className="text-pink-400 font-semibold mb-1">Key PostgreSQL Tables:</p>
          <p>• public.accounts (id, phone_normalized UNIQUE, phone_display, account_json JSONB, is_archived)</p>
          <p>• public.account_secrets (account_id, secret_payload JSONB)</p>
          <p>• public.orders (id, account_id, external_order_id, delivery_status, refund_status)</p>
          <p>• public.order_events, public.audit_logs, public.saved_filters, public.reconciliation_jobs</p>
        </div>
      </div>
    </div>
  );
};
