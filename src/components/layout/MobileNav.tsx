import React from 'react';
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
  X,
  Package,
  Send,
  CreditCard,
} from 'lucide-react';

interface NavItem {
  id: NavigationTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
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

export const MobileNav: React.FC = () => {
  const { activeTab, setActiveTab, isMobileNavOpen, setIsMobileNavOpen } = useApp();

  if (!isMobileNavOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => setIsMobileNavOpen(false)}
      />

      {/* Drawer */}
      <div className="relative w-72 max-w-[85vw] bg-slate-950 border-r border-slate-800 h-full flex flex-col z-10 animate-in slide-in-from-left duration-200">
        <div className="flex items-center justify-between h-16 px-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-pink-700 flex items-center justify-center text-white">
              <Package className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-slate-100 text-sm">Meesho Console</span>
              <span className="text-[10px] text-pink-400 font-medium">Enterprise Mobile</span>
            </div>
          </div>
          <button
            onClick={() => setIsMobileNavOpen(false)}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsMobileNavOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-pink-700/20 text-pink-300 border border-pink-700/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-pink-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
