import React from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { StorageService } from '../../lib/storageAdapter';
import {
  Menu,
  Search,
  Undo2,
  Shield,
  Database,
  LogOut,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';

export const Topbar: React.FC = () => {
  const {
    isMobileNavOpen,
    setIsMobileNavOpen,
    triggerUndo,
    accountSearchQuery,
    setAccountSearchQuery,
    setActiveTab,
  } = useApp();
  const { signOut } = useAuth();

  const undoCount = StorageService.getUndoStackCount();

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveTab('accounts');
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
      {/* Left: Mobile Menu Toggle & Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
          className="lg:hidden p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          aria-label="Toggle mobile menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <form onSubmit={handleSearchSubmit} className="relative hidden md:block w-72 lg:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={accountSearchQuery}
            onChange={e => setAccountSearchQuery(e.target.value)}
            placeholder="Search mobile number (e.g. 9033807401)..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 font-mono transition-all"
          />
        </form>
      </div>

      {/* Right Action Controls */}
      <div className="flex items-center gap-2.5 sm:gap-4">
        {/* Undo Action */}
        <button
          onClick={() => triggerUndo()}
          disabled={undoCount === 0}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
            undoCount > 0
              ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white'
              : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed opacity-60'
          }`}
          title="Undo last modification"
        >
          <Undo2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Undo</span>
          {undoCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-pink-600 text-white text-[10px] flex items-center justify-center font-bold">
              {undoCount}
            </span>
          )}
        </button>

        {/* Database Status */}
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border ${
            isSupabaseConfigured
              ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
              : 'bg-amber-950/60 text-amber-300 border-amber-800/60'
          }`}
        >
          <Database className="w-3 h-3" />
          <span>{isSupabaseConfigured ? 'Supabase Live' : 'Local Sandbox'}</span>
        </div>

        {/* Authenticated Administrator Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pink-950/40 border border-pink-500/30 text-xs">
          <Shield className="w-3.5 h-3.5 text-pink-400" />
          <span className="font-semibold text-pink-200 hidden md:inline">Admin</span>
          <span className="text-[10px] bg-pink-500/20 text-pink-300 font-mono px-1 py-0.2 rounded">Private</span>
        </div>

        {/* Sign Out Button */}
        <button
          type="button"
          onClick={() => signOut()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-200 rounded-lg text-xs font-semibold border border-slate-700 hover:border-rose-500/40 transition-all cursor-pointer"
          title="Sign out and invalidate session"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
};
