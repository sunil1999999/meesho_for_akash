/**
 * Production-Grade Authentication & Access Control Engine
 * 
 * Implements:
 * - Single-user administrator authentication
 * - Bcrypt password hashing (cost factor 12) with scrypt fallback
 * - Cryptographically random, HMAC-signed session tokens
 * - HttpOnly, SameSite=Lax, Secure cookie management
 * - In-memory brute-force protection (5 attempts / 15-min lockout)
 * - Server-side request gating for all protected API endpoints
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export interface AdminUser {
  username: string;
}

export interface SessionData {
  sessionId: string;
  username: string;
  createdAt: number;
  expiresAt: number;
  ip: string;
  userAgent: string;
}

export interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lockedUntil: number | null;
}

// 7 days session duration
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout
const COOKIE_NAME = 'meesho_admin_session';

export class AuthService {
  private sessions: Map<string, SessionData> = new Map();
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private sessionSecret: string;
  private adminUsername: string;
  private adminPasswordHash: string;

  constructor(options?: {
    adminUsername?: string;
    adminPasswordHash?: string;
    sessionSecret?: string;
  }) {
    this.adminUsername = options?.adminUsername || process.env.ADMIN_USERNAME || 'admin';
    this.adminPasswordHash =
      options?.adminPasswordHash ||
      process.env.ADMIN_PASSWORD_HASH ||
      // Default fallback: hash of 'Admin@Meesho2026!Secure'
      '$2b$12$y9VP6J04ABZbZ4i/T1cmL.tdZYejwpOc.7Zi5AKkh8P0HkWcGH3Iq';
    this.sessionSecret =
      options?.sessionSecret ||
      process.env.SESSION_SECRET ||
      '7649901cca6ab05c3319a0ccc9b4cdd182253af93a6489d6a2734fa9b3ca657d';
  }

  /**
   * Hashes a plaintext password using bcrypt (cost factor 12).
   */
  public async hashPassword(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, 12);
  }

  /**
   * Verifies a plaintext password against the configured hash.
   */
  public async verifyPassword(plaintext: string, hash?: string): Promise<boolean> {
    if (!plaintext || typeof plaintext !== 'string') {
      return false;
    }
    const targetHash =
      hash !== undefined
        ? hash
        : process.env.ADMIN_PASSWORD_HASH || this.adminPasswordHash;
    if (!targetHash || typeof targetHash !== 'string') {
      return false;
    }

    try {
      if (targetHash.startsWith('$2a$') || targetHash.startsWith('$2b$') || targetHash.startsWith('$2y$')) {
        return await bcrypt.compare(plaintext, targetHash);
      }

      // Support constant-time scrypt hash format: scrypt$<saltHex>$<hashHex>
      if (targetHash.startsWith('scrypt$')) {
        const parts = targetHash.split('$');
        if (parts.length === 3) {
          const salt = Buffer.from(parts[1], 'hex');
          const expected = Buffer.from(parts[2], 'hex');
          const derived = crypto.scryptSync(plaintext, salt, 64);
          return crypto.timingSafeEqual(expected, derived);
        }
      }

      return false;
    } catch (err) {
      console.error('[AUTH ERROR] Password verification exception:', err);
      return false;
    }
  }

  /**
   * Checks rate limit status for a given identifier (IP or username).
   */
  public checkRateLimit(key: string): { allowed: boolean; remainingAttempts: number; retryAfterSec?: number } {
    const now = Date.now();
    const entry = this.rateLimits.get(key);

    if (!entry) {
      return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
    }

    // Check if lockout has expired
    if (entry.lockedUntil) {
      if (now < entry.lockedUntil) {
        const retryAfterSec = Math.ceil((entry.lockedUntil - now) / 1000);
        return { allowed: false, remainingAttempts: 0, retryAfterSec };
      }
      // Lockout expired, reset entry
      this.rateLimits.delete(key);
      return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
    }

    // Reset counter if window (15 mins) has elapsed since first attempt
    if (now - entry.firstAttempt > LOCKOUT_DURATION_MS) {
      this.rateLimits.delete(key);
      return { allowed: true, remainingAttempts: MAX_FAILED_ATTEMPTS };
    }

    const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - entry.count);
    return { allowed: remaining > 0, remainingAttempts: remaining };
  }

  /**
   * Records a failed login attempt. Enforces lockout when threshold is reached.
   */
  public recordFailedAttempt(key: string): { locked: boolean; retryAfterSec?: number } {
    const now = Date.now();
    let entry = this.rateLimits.get(key);

    if (!entry || now - entry.firstAttempt > LOCKOUT_DURATION_MS) {
      entry = { count: 1, firstAttempt: now, lockedUntil: null };
    } else {
      entry.count += 1;
    }

    if (entry.count >= MAX_FAILED_ATTEMPTS) {
      entry.lockedUntil = now + LOCKOUT_DURATION_MS;
      this.rateLimits.set(key, entry);
      const retryAfterSec = Math.ceil(LOCKOUT_DURATION_MS / 1000);
      console.warn(`[AUTH SECURITY] Account/IP '${key}' LOCKED OUT for 15 minutes after ${entry.count} failed attempts.`);
      return { locked: true, retryAfterSec };
    }

    this.rateLimits.set(key, entry);
    console.warn(`[AUTH SECURITY] Failed login attempt for '${key}' (attempt ${entry.count}/${MAX_FAILED_ATTEMPTS}).`);
    return { locked: false };
  }

  /**
   * Resets the rate limit counter upon successful authentication.
   */
  public resetRateLimit(key: string): void {
    this.rateLimits.delete(key);
  }

  /**
   * Creates an active server-side session and returns the signed cookie value.
   */
  public createSession(username: string, ip: string, userAgent: string, ttlMs = DEFAULT_SESSION_TTL_MS): {
    sessionId: string;
    cookieValue: string;
    expiresAt: number;
  } {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + ttlMs;

    const session: SessionData = {
      sessionId,
      username,
      createdAt: now,
      expiresAt,
      ip,
      userAgent,
    };

    this.sessions.set(sessionId, session);

    // Sign session token with HMAC-SHA256
    const signature = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(sessionId)
      .digest('hex');

    const cookieValue = `${sessionId}.${signature}`;
    return { sessionId, cookieValue, expiresAt };
  }

  /**
   * Validates a session from the incoming Cookie header.
   */
  public validateSession(cookieHeader?: string): {
    valid: boolean;
    session?: SessionData;
  } {
    if (!cookieHeader) {
      return { valid: false };
    }

    const cookies = this.parseCookies(cookieHeader);
    const token = cookies[COOKIE_NAME];
    if (!token) {
      return { valid: false };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false };
    }

    const [sessionId, providedSignature] = parts;

    // Verify HMAC signature in constant time
    const expectedSignature = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(sessionId)
      .digest('hex');

    if (
      providedSignature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))
    ) {
      console.warn('[AUTH SECURITY] Invalid session cookie signature detected.');
      return { valid: false };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return { valid: false };
    }

    // Check expiration
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return { valid: false };
    }

    return { valid: true, session };
  }

  /**
   * Invalidates and deletes a session (logout).
   */
  public invalidateSession(cookieHeader?: string): boolean {
    if (!cookieHeader) return false;
    const cookies = this.parseCookies(cookieHeader);
    const token = cookies[COOKIE_NAME];
    if (!token) return false;

    const [sessionId] = token.split('.');
    if (sessionId && this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Generates Set-Cookie header string with strict security flags.
   */
  public serializeSessionCookie(
    cookieValue: string,
    options?: { isSecure?: boolean; maxAgeMs?: number }
  ): string {
    const isSecure = options?.isSecure ?? (process.env.NODE_ENV === 'production');
    const maxAgeSec = Math.floor((options?.maxAgeMs || DEFAULT_SESSION_TTL_MS) / 1000);

    const parts = [
      `${COOKIE_NAME}=${cookieValue}`,
      'Path=/',
      `Max-Age=${maxAgeSec}`,
      'HttpOnly',
      'SameSite=Lax',
    ];

    if (isSecure) {
      parts.push('Secure');
    }

    return parts.join('; ');
  }

  /**
   * Generates expired Set-Cookie header string to clear cookie on client.
   */
  public serializeClearCookie(isSecure?: boolean): string {
    const secureFlag = (isSecure ?? (process.env.NODE_ENV === 'production')) ? '; Secure' : '';
    return `${COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureFlag}`;
  }

  public getAdminUsername(): string {
    return this.adminUsername;
  }

  public getActiveSessionCount(): number {
    return this.sessions.size;
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    const list: Record<string, string> = {};
    cookieHeader.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      const key = parts.shift()?.trim();
      const val = parts.join('=').trim();
      if (key) list[key] = decodeURIComponent(val);
    });
    return list;
  }
}

// Global Singleton Instance
export const authService = new AuthService();
