import React, { createContext, useContext, useState, useCallback } from 'react';
import { StorageService } from '../lib/storageAdapter';

export type NavigationTab =
  | 'overview'
  | 'accounts'
  | 'orders'
  | 'direct_checkout'
  | 'returns'
  | 'imports'
  | 'exports'
  | 'reconciliation'
  | 'data_quality'
  | 'saved_filters'
  | 'history'
  | 'audit'
  | 'recycle_bin'
  | 'telegram_sync'
  | 'users'
  | 'settings';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
  showUndo?: boolean;
}

interface AppContextType {
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  isMobileNavOpen: boolean;
  setIsMobileNavOpen: (open: boolean) => void;
  toasts: ToastMessage[];
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info', showUndo?: boolean) => void;
  removeToast: (id: string) => void;
  triggerUndo: () => Promise<void>;
  dataVersion: number;
  refreshData: () => void;
  viewingAccountId: string | null;
  setViewingAccountId: (id: string | null) => void;
  accountSearchQuery: string;
  setAccountSearchQuery: (q: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [dataVersion, setDataVersion] = useState<number>(0);
  const [viewingAccountId, setViewingAccountId] = useState<string | null>(null);
  const [accountSearchQuery, setAccountSearchQuery] = useState<string>('');

  const refreshData = useCallback(() => {
    setDataVersion(v => v + 1);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((
    message: string,
    type: 'success' | 'error' | 'warning' | 'info' = 'info',
    showUndo: boolean = false
  ) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastMessage = { id, message, type, showUndo };
    setToasts(prev => [...prev, newToast]);

    setTimeout(() => {
      removeToast(id);
    }, 4500);
  }, [removeToast]);

  const triggerUndo = useCallback(async () => {
    const res = await StorageService.popUndo();
    if (res.success) {
      showToast(`Reverted: ${res.description || 'Action undone'}`, 'success');
      refreshData();
    } else {
      showToast('No actions available to undo', 'warning');
    }
  }, [showToast, refreshData]);

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        isMobileNavOpen,
        setIsMobileNavOpen,
        toasts,
        showToast,
        removeToast,
        triggerUndo,
        dataVersion,
        refreshData,
        viewingAccountId,
        setViewingAccountId,
        accountSearchQuery,
        setAccountSearchQuery,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
