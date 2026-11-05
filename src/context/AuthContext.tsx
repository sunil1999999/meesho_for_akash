import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';

interface AuthContextType {
  currentUser: UserProfile;
  isAuthenticated: boolean;
  isLoading: boolean;
  canViewSensitiveTokens: boolean;
  canArchive: boolean;
  canPermanentDelete: boolean;
  canPerformBulkEdit: boolean;
  setCurrentUserRole: (role: 'admin' | 'operations_manager' | 'viewer') => void;
  requestSensitiveAuthorization: () => Promise<boolean>;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; retryAfter?: number }>;
  signOut: () => Promise<void>;
  checkSession: () => Promise<boolean>;
}

const defaultAdminUser: UserProfile = {
  id: 'usr_admin_01',
  email: 'admin@meesho.internal',
  full_name: 'Administrator',
  role: 'admin',
  created_at: new Date().toISOString(),
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserProfile>(defaultAdminUser);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasTemporarilyAuthorizedSensitive, setHasTemporarilyAuthorizedSensitive] = useState<boolean>(false);

  /**
   * Checks current server-side session validity.
   */
  const checkSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.authenticated && data.user) {
        setIsAuthenticated(true);
        setCurrentUser({
          id: 'usr_admin_01',
          email: `${data.user.username}@meesho.internal`,
          full_name: data.user.username === 'admin' ? 'Primary Administrator' : data.user.username,
          role: 'admin',
          created_at: new Date().toISOString(),
        });
        return true;
      }
      setIsAuthenticated(false);
      return false;
    } catch (err) {
      console.warn('[AUTH] Session verification error:', err);
      setIsAuthenticated(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  /**
   * Authenticates against the secure server endpoint.
   */
  const login = async (
    username: string,
    password: string
  ): Promise<{ success: boolean; error?: string; retryAfter?: number }> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setIsAuthenticated(true);
        setCurrentUser({
          id: 'usr_admin_01',
          email: `${data.user?.username || username}@meesho.internal`,
          full_name: data.user?.username === 'admin' ? 'Primary Administrator' : (data.user?.username || username),
          role: 'admin',
          created_at: new Date().toISOString(),
        });
        return { success: true };
      }

      return {
        success: false,
        error: data.error || 'Authentication failed. Please verify credentials.',
        retryAfter: data.retryAfter,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Server communication error. Please try again.',
      };
    }
  };

  /**
   * Invalidates active server-side session and clears client state.
   */
  const signOut = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
    } catch (err) {
      console.warn('[AUTH] Error during sign out:', err);
    } finally {
      setIsAuthenticated(false);
      setHasTemporarilyAuthorizedSensitive(false);
      setCurrentUser({
        id: 'usr_logged_out',
        email: 'logged_out@meesho.internal',
        full_name: 'Logged Out',
        role: 'viewer',
        created_at: new Date().toISOString(),
      });
    }
  };

  const setCurrentUserRole = (role: 'admin' | 'operations_manager' | 'viewer') => {
    setCurrentUser((prev) => ({ ...prev, role }));
  };

  const requestSensitiveAuthorization = async (): Promise<boolean> => {
    if (isAuthenticated && currentUser.role === 'admin') {
      setHasTemporarilyAuthorizedSensitive(true);
      return true;
    }
    return false;
  };

  const canViewSensitiveTokens = isAuthenticated && (currentUser.role === 'admin' || hasTemporarilyAuthorizedSensitive);
  const canArchive = isAuthenticated && (currentUser.role === 'admin' || currentUser.role === 'operations_manager');
  const canPermanentDelete = isAuthenticated && currentUser.role === 'admin';
  const canPerformBulkEdit = isAuthenticated && (currentUser.role === 'admin' || currentUser.role === 'operations_manager');

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated,
        isLoading,
        canViewSensitiveTokens,
        canArchive,
        canPermanentDelete,
        canPerformBulkEdit,
        setCurrentUserRole,
        requestSensitiveAuthorization,
        login,
        signOut,
        checkSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
