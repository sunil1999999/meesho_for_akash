/**
 * Token Health & Expiry Sentinel for Meesho Account Sessions
 * 
 * Inspects composite JWT / Meesho xo tokens and provides real-time health grading:
 *   - 🟢 Active & Ready (> 24 hours / < 2 days)
 *   - 🟡 Expiring Soon (< 24 hours)
 *   - 🔴 Expired / Needs Re-Auth (expired or invalid)
 */

export type TokenHealthStatus = 'active' | 'expiring_soon' | 'expired' | 'no_token';

export interface TokenHealthInfo {
  status: TokenHealthStatus;
  label: string;
  shortLabel: string;
  hoursRemaining?: number;
  expiresInSeconds?: number;
  expiresAt?: string;
  badgeClass: string;
}

/**
 * Safely decodes base64url strings in browser and node environments
 */
function safeBase64UrlDecode(str: string): string {
  try {
    let clean = str.replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4) {
      clean += '=';
    }
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(clean);
    }
    if (typeof (globalThis as any).Buffer !== 'undefined') {
      return (globalThis as any).Buffer.from(clean, 'base64').toString('utf-8');
    }
  } catch {}
  return '';
}

/**
 * Parses JWT expiration timestamp from Meesho's composite or direct xo token
 */
export function extractTokenExpiry(accountJson?: Record<string, any> | null): number | null {
  if (!accountJson || typeof accountJson !== 'object') return null;

  // 1. Direct explicit xo_exp property if cached
  if (typeof accountJson.xo_exp === 'number' && accountJson.xo_exp > 0) {
    return accountJson.xo_exp;
  }

  // 2. Extract from xo composite token
  const xo = accountJson.xo;
  if (typeof xo !== 'string' || !xo.trim()) {
    return null;
  }

  try {
    const parts = xo.split('.');
    if (parts.length >= 2) {
      const decodedPayloadStr = safeBase64UrlDecode(parts[1]);
      if (decodedPayloadStr) {
        const decodedPayload = JSON.parse(decodedPayloadStr);
        const innerJwt = decodedPayload.jwt;
        
        // Inner JWT inside composite payload
        if (typeof innerJwt === 'string') {
          const jwtParts = innerJwt.split('.');
          if (jwtParts.length >= 2) {
            const innerPayloadStr = safeBase64UrlDecode(jwtParts[1]);
            if (innerPayloadStr) {
              const innerPayload = JSON.parse(innerPayloadStr);
              if (innerPayload.exp) {
                return Number(innerPayload.exp);
              }
            }
          }
        } else if (decodedPayload.exp) {
          return Number(decodedPayload.exp);
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Evaluates the token health status for an account JSON record
 */
export function getTokenHealth(accountJson?: Record<string, any> | null): TokenHealthInfo {
  if (!accountJson || !accountJson.xo) {
    return {
      status: 'no_token',
      label: 'No Auth Token',
      shortLabel: 'No Token',
      badgeClass: 'bg-slate-800/80 text-slate-400 border-slate-700/60',
    };
  }

  const exp = extractTokenExpiry(accountJson);
  if (!exp) {
    return {
      status: 'no_token',
      label: 'Unverified Token',
      shortLabel: 'Unverified',
      badgeClass: 'bg-slate-800/80 text-slate-400 border-slate-700/60',
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = exp - nowSec;
  const hours = diffSec / 3600;

  // 🔴 Expired
  if (diffSec <= 0) {
    const expiredHoursAgo = Math.abs(Math.floor(hours));
    const label = expiredHoursAgo > 24 
      ? `Expired ${Math.floor(expiredHoursAgo / 24)}d ago` 
      : `Expired ${expiredHoursAgo}h ago`;
    return {
      status: 'expired',
      label,
      shortLabel: 'Expired',
      hoursRemaining: hours,
      expiresInSeconds: diffSec,
      expiresAt: new Date(exp * 1000).toISOString(),
      badgeClass: 'bg-rose-950/90 text-rose-300 border-rose-700/80',
    };
  }

  // 🟡 Expiring Soon (< 24 hours)
  if (diffSec < 24 * 3600) {
    const wholeHours = Math.floor(hours);
    const wholeMins = Math.floor((diffSec % 3600) / 60);
    return {
      status: 'expiring_soon',
      label: `Expiring in ${wholeHours}h ${wholeMins}m`,
      shortLabel: `< ${wholeHours + 1}h`,
      hoursRemaining: hours,
      expiresInSeconds: diffSec,
      expiresAt: new Date(exp * 1000).toISOString(),
      badgeClass: 'bg-amber-950/90 text-amber-300 border-amber-600/80 shadow-sm animate-pulse',
    };
  }

  // 🟢 Active & Ready (> 24 hours)
  const wholeDays = Math.floor(diffSec / 86400);
  const remHours = Math.floor((diffSec % 86400) / 3600);
  return {
    status: 'active',
    label: `Active (${wholeDays}d ${remHours}h)`,
    shortLabel: 'Active',
    hoursRemaining: hours,
    expiresInSeconds: diffSec,
    expiresAt: new Date(exp * 1000).toISOString(),
    badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-700/70',
  };
}
