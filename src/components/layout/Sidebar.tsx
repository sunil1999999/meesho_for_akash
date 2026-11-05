import React, { useState } from 'react';
import { useApp, NavigationTab } from '../../context/AppContext';
import {
  LayoutDashboard,
  Users,
  ShoppingBag,
  RotateCcw,
  UploadCloud,
  DownloadCloud,
  FileSpreadsheet,
  ShieldCheck,
  Filter,
  History,
  FileText,
  Trash2,
  UserCheck,
  Settings,
  ChevronLeft,
  ChevronRight,
  Package,
  Send,
  CreditCard,
} from 'lucide-react';

interface NavItem {
  id: NavigationTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Dashboard Overview', icon: LayoutDashboard },
  { id: 'accounts', label: 'Accounts', icon: Users },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'direct_checkout', label: 'Direct Checkout & Pay', icon: CreditCard },
  { id: 'returns', label: 'Returns & Refunds', icon: RotateCcw },
  { id: 'telegram_sync', label: 'Telegram Bot Sync', icon: Send },
  { id: 'imports', label: 'Import Center', icon: UploadCloud },
  { id: 'exports', label: 'Export Center', icon: DownloadCloud },
  { id: 'reconciliation', label: 'CSV Reconciliation', icon: FileSpreadsheet },
  { id: 'data_quality', label: 'Data Quality', icon: ShieldCheck },
  { id: 'saved_filters', label: 'Saved Filters', icon: Filter },
  { id: 'history', label: 'Import History', icon: History },
  { id: 'audit', label: 'Audit Logs', icon: FileText },
  { id: 'recycle_bin', label: 'Recycle Bin', icon: Trash2 },
  { id: 'users', label: 'User Management', icon: UserCheck },
  { id: 'settings', label: 'Settings & Supabase', icon: Settings },
];

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab } = useApp();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside
      className={`hidden lg:flex flex-col border-r border-slate-800 bg-slate-950/95 backdrop-blur-md transition-all duration-300 z-30 select-none ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-600 via-rose-700 to-pink-900 flex items-center justify-center shadow-lg shadow-pink-900/40 shrink-0">
            <Package className="w-5 h-5 text-white" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-slate-100 tracking-tight text-base truncate">
                Meesho Console
              </span>
              <span className="text-[10px] text-pink-400 font-medium tracking-wide uppercase">
                Enterprise v2.0
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group relative cursor-pointer ${
                isActive
                  ? 'bg-pink-700/20 text-pink-300 border border-pink-700/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              } ${isCollapsed ? 'justify-center' : ''}`}
            >
              <Icon
                className={`w-5 h-5 shrink-0 transition-colors ${
                  isActive ? 'text-pink-400' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              />
              {!isCollapsed && <span className="truncate">{item.label}</span>}

              {isActive && (
                <div
                  className={`absolute left-0 top-1.5 bottom-1.5 w-1 bg-pink-500 rounded-r ${
                    isCollapsed ? 'hidden' : 'block'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Footer System Status */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950">
        {!isCollapsed ? (
          <div className="flex items-center justify-between text-xs text-slate-400 px-2 py-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>PostgreSQL Ready</span>
            </div>
            <span className="font-mono text-[10px] text-slate-500">RLS Active</span>
          </div>
        ) : (
          <div className="flex justify-center" title="PostgreSQL Ready">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        )}
      </div>
    </aside>
  );
};
