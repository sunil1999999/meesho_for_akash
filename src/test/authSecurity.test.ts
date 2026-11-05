import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from '../server/auth';
import { createAuthMiddleware } from '../server/authMiddleware';

describe('Single-User Authentication & Security Test Suite', () => {
  let authService: AuthService;
  const testPassword = 'Admin@Meesho2026!Secure';
  let testHash: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    authService = new AuthService();
    testHash = await authService.hashPassword(testPassword);
  });

  describe('1. Strong Password Hashing & Verification', () => {
    it('generates a valid salted bcrypt hash with cost factor 12', async () => {
      const hash = await authService.hashPassword('SuperSecret123!');
      expect(hash).toMatch(/^\$2[aby]\$12\$/);
      expect(hash).not.toBe('SuperSecret123!');
    });

    it('verifies correct administrator password against hash', async () => {
      const isValid = await authService.verifyPassword(testPassword, testHash);
      expect(isValid).toBe(true);
    });

    it('rejects incorrect passwords with constant-time verification', async () => {
      const isValid = await authService.verifyPassword('WrongPassword123!', testHash);
      expect(isValid).toBe(false);
    });

    it('rejects empty passwords or missing hashes safely', async () => {
      expect(await authService.verifyPassword('', testHash)).toBe(false);
      expect(await authService.verifyPassword(testPassword, '')).toBe(false);
    });
  });

  describe('2. Cryptographic Sessions & Cookie Security', () => {
    it('creates HMAC-SHA256 signed session token with expiration', () => {
      const session = authService.createSession('admin', '127.0.0.1', 'Vitest');
      expect(session.sessionId).toHaveLength(64);
      expect(session.cookieValue).toContain('.');
      expect(session.expiresAt).toBeGreaterThan(Date.now());
      expect(authService.getActiveSessionCount()).toBe(1);
    });

    it('validates authentic session cookie and extracts session data', () => {
      const session = authService.createSession('admin', '127.0.0.1', 'Vitest');
      const cookieHeader = `meesho_admin_session=${session.cookieValue}`;

      const result = authService.validateSession(cookieHeader);
      expect(result.valid).toBe(true);
      expect(result.session?.username).toBe('admin');
      expect(result.session?.sessionId).toBe(session.sessionId);
    });

    it('rejects tampered or forged session signatures', () => {
      const session = authService.createSession('admin', '127.0.0.1', 'Vitest');
      const forgedCookie = `meesho_admin_session=${session.sessionId}.forged_fake_signature`;

      const result = authService.validateSession(forgedCookie);
      expect(result.valid).toBe(false);
      expect(result.session).toBeUndefined();
    });

    it('rejects expired session tokens', () => {
      // Create session with negative TTL (already expired)
      const session = authService.createSession('admin', '127.0.0.1', 'Vitest', -1000);
      const cookieHeader = `meesho_admin_session=${session.cookieValue}`;

      const result = authService.validateSession(cookieHeader);
      expect(result.valid).toBe(false);
    });

    it('invalidates and deletes session from registry upon logout', () => {
      const session = authService.createSession('admin', '127.0.0.1', 'Vitest');
      const cookieHeader = `meesho_admin_session=${session.cookieValue}`;

      expect(authService.validateSession(cookieHeader).valid).toBe(true);

      const invalidated = authService.invalidateSession(cookieHeader);
      expect(invalidated).toBe(true);
      expect(authService.validateSession(cookieHeader).valid).toBe(false);
      expect(authService.getActiveSessionCount()).toBe(0);
    });

    it('serializes session cookie with strict security flags (HttpOnly, SameSite=Lax, Secure)', () => {
      const cookie = authService.serializeSessionCookie('mock_val', { isSecure: true, maxAgeMs: 3600000 });
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('Max-Age=3600');
    });

    it('serializes clear cookie to immediately expire client cookie on sign out', () => {
      const clearCookie = authService.serializeClearCookie(true);
      expect(clearCookie).toContain('Max-Age=0');
      expect(clearCookie).toContain('Expires=Thu, 01 Jan 1970');
      expect(clearCookie).toContain('HttpOnly');
      expect(clearCookie).toContain('Secure');
    });
  });

  describe('3. Anti-Brute-Force Rate Limiting & Lockout', () => {
    it('allows initial attempts and tracks remaining allowance', () => {
      const status = authService.checkRateLimit('192.168.1.50');
      expect(status.allowed).toBe(true);
      expect(status.remainingAttempts).toBe(5);
    });

    it('enforces lockout after 5 consecutive failed attempts', () => {
      const key = '192.168.1.99';

      for (let i = 1; i <= 4; i++) {
        const attempt = authService.recordFailedAttempt(key);
        expect(attempt.locked).toBe(false);
      }

      // 5th failed attempt triggers lockout
      const fifth = authService.recordFailedAttempt(key);
      expect(fifth.locked).toBe(true);
      expect(fifth.retryAfterSec).toBeGreaterThan(0);

      const status = authService.checkRateLimit(key);
      expect(status.allowed).toBe(false);
      expect(status.remainingAttempts).toBe(0);
      expect(status.retryAfterSec).toBeGreaterThan(800);
    });

    it('resets rate limit counter on successful login', () => {
      const key = '192.168.1.100';
      authService.recordFailedAttempt(key);
      authService.recordFailedAttempt(key);

      expect(authService.checkRateLimit(key).remainingAttempts).toBe(3);

      authService.resetRateLimit(key);
      expect(authService.checkRateLimit(key).remainingAttempts).toBe(5);
    });
  });

  describe('4. Server Middleware API Protection', () => {
    it('blocks unauthenticated requests to /api/checkout/quote with HTTP 401', async () => {
      const middleware = createAuthMiddleware(authService);

      const req: any = {
        url: '/api/checkout/quote',
        method: 'POST',
        headers: {},
      };

      let responseStatus = 200;
      let responseBody = '';
      const res: any = {
        setHeader: vi.fn(),
        end: (data: string) => { responseBody = data; },
        get statusCode() { return responseStatus; },
        set statusCode(val) { responseStatus = val; },
      };

      const next = vi.fn();
      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(responseStatus).toBe(401);
      const json = JSON.parse(responseBody);
      expect(json.authenticated).toBe(false);
      expect(json.error).toContain('Unauthorized');
    });

    it('blocks unauthenticated requests to /api/telegram/status with HTTP 401', async () => {
      const middleware = createAuthMiddleware(authService);

      const req: any = {
        url: '/api/telegram/status',
        method: 'GET',
        headers: {},
      };

      let responseStatus = 200;
      let responseBody = '';
      const res: any = {
        setHeader: vi.fn(),
        end: (data: string) => { responseBody = data; },
        get statusCode() { return responseStatus; },
        set statusCode(val) { responseStatus = val; },
      };

      const next = vi.fn();
      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(responseStatus).toBe(401);
      expect(JSON.parse(responseBody).error).toContain('Unauthorized');
    });

    it('allows authenticated requests with valid session cookie to reach protected APIs', async () => {
      const middleware = createAuthMiddleware(authService);
      const session = authService.createSession('admin', '127.0.0.1', 'Vitest');

      const req: any = {
        url: '/api/checkout/free-checkout',
        method: 'POST',
        headers: {
          cookie: `meesho_admin_session=${session.cookieValue}`,
        },
      };

      const res: any = {
        setHeader: vi.fn(),
        end: vi.fn(),
      };

      const next = vi.fn();
      await middleware(req, res, next);

      // Crucial: next() must be called, allowing request to proceed to the backend bridge
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user?.username).toBe('admin');
    });

    it('handles GET /api/auth/session returning authentication status', async () => {
      const middleware = createAuthMiddleware(authService);

      // Unauthenticated check
      const reqUnauth: any = {
        url: '/api/auth/session',
        method: 'GET',
        headers: {},
      };

      let responseBody = '';
      const resUnauth: any = {
        setHeader: vi.fn(),
        end: (d: string) => { responseBody = d; },
      };

      await middleware(reqUnauth, resUnauth, vi.fn());
      expect(JSON.parse(responseBody).authenticated).toBe(false);

      // Authenticated check
      const session = authService.createSession('admin', '127.0.0.1', 'Vitest');
      const reqAuth: any = {
        url: '/api/auth/session',
        method: 'GET',
        headers: {
          cookie: `meesho_admin_session=${session.cookieValue}`,
        },
      };

      let authBody = '';
      const resAuth: any = {
        setHeader: vi.fn(),
        end: (d: string) => { authBody = d; },
      };

      await middleware(reqAuth, resAuth, vi.fn());
      const authJson = JSON.parse(authBody);
      expect(authJson.authenticated).toBe(true);
      expect(authJson.user?.username).toBe('admin');
    });
  });
});
