/**
 * Payment Mode & Configuration Management
 * Manages Free Payment Mode vs Real Payment Mode for Meesho Direct Checkout.
 */

const STORAGE_KEY = 'meesho_free_payment_mode';

// Detect default from Vite environment (defaults to true if configured or testing)
function getDefaultFreePaymentMode(): boolean {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      return saved === 'true';
    }
  }

  // Fallback to environment variable if present
  try {
    const envVal = import.meta.env?.VITE_FREE_PAYMENT_MODE;
    if (envVal !== undefined) {
      return String(envVal).toLowerCase() === 'true';
    }
  } catch {
    // Fallback if import.meta.env is undefined in testing environment
  }

  return true;
}

let currentFreeMode: boolean = getDefaultFreePaymentMode();
const listeners: Set<(enabled: boolean) => void> = new Set();

export const PaymentConfig = {
  /**
   * Checks whether Free Payment Mode is currently enabled.
   */
  isFreePaymentMode(): boolean {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        return saved === 'true';
      }
    }
    return currentFreeMode;
  },

  /**
   * Sets Free Payment Mode on or off and persists to localStorage.
   */
  setFreePaymentMode(enabled: boolean): void {
    currentFreeMode = enabled;
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    }
    listeners.forEach((fn) => {
      try {
        fn(enabled);
      } catch (err) {
        console.warn('PaymentConfig listener error:', err);
      }
    });
  },

  /**
   * Subscribes to changes in payment mode.
   */
  subscribe(listener: (enabled: boolean) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  resetToDefault(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    const defaultMode = getDefaultFreePaymentMode();
    currentFreeMode = defaultMode;
    listeners.forEach((fn) => {
      try {
        fn(defaultMode);
      } catch (err) {
        console.warn('PaymentConfig listener error:', err);
      }
    });
  },
};
