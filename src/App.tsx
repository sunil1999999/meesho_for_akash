import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider, useApp } from './context/AppContext';
import { LoginView } from './views/LoginView';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { MobileNav } from './components/layout/MobileNav';
import { ToastContainer } from './components/common/ToastContainer';

import { DashboardOverview } from './views/DashboardOverview';
import { AccountsView } from './views/AccountsView';
import { OrdersView } from './views/OrdersView';
import { ReturnsRefundsView } from './views/ReturnsRefundsView';
import { ImportCenterView } from './views/ImportCenterView';
import { ExportCenterView } from './views/ExportCenterView';
import { CsvReconciliationView } from './views/CsvReconciliationView';
import { DataQualityView } from './views/DataQualityView';
import { SavedFiltersView } from './views/SavedFiltersView';
import { ImportHistoryView } from './views/ImportHistoryView';
import { AuditLogsView } from './views/AuditLogsView';
import { RecycleBinView } from './views/RecycleBinView';
import { UserManagementView } from './views/UserManagementView';
import { SettingsView } from './views/SettingsView';
import { TelegramSyncView } from './views/TelegramSyncView';
import { DirectCheckoutView } from './views/DirectCheckoutView';

const MainLayout: React.FC = () => {
  const { activeTab } = useApp();

  const renderActiveView = () => {
    switch (activeTab) {
      case 'overview':
        return <DashboardOverview />;
      case 'accounts':
        return <AccountsView />;
      case 'orders':
        return <OrdersView />;
      case 'direct_checkout':
        return <DirectCheckoutView />;
      case 'returns':
        return <ReturnsRefundsView />;
      case 'telegram_sync':
        return <TelegramSyncView />;
      case 'imports':
        return <ImportCenterView />;
      case 'exports':
        return <ExportCenterView />;
      case 'reconciliation':
        return <CsvReconciliationView />;
      case 'data_quality':
        return <DataQualityView />;
      case 'saved_filters':
        return <SavedFiltersView />;
      case 'history':
        return <ImportHistoryView />;
      case 'audit':
        return <AuditLogsView />;
      case 'recycle_bin':
        return <RecycleBinView />;
      case 'users':
        return <UserManagementView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardOverview />;
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Mobile Drawer */}
      <MobileNav />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar */}
        <Topbar />

        {/* Viewport */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-950/90">
          <div className="max-w-7xl mx-auto">{renderActiveView()}</div>
        </main>
      </div>

      {/* Global Toast Alerts */}
      <ToastContainer />
    </div>
  );
};

const AuthenticatedApp: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-slate-100">
        <div className="w-10 h-10 border-3 border-pink-500/20 border-t-pink-500 rounded-full animate-spin mb-4" />
        <span className="text-xs text-slate-400 font-mono tracking-wider uppercase">
          Verifying Secure Session...
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
};

export function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

export default App;
