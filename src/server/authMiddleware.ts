/**
 * Server Authentication Middleware for Vite Dev & Preview Servers
 *
 * Enforces server-side authentication across all protected API routes,
 * manages login/logout/session endpoints, rate limiting, and HTTP-only cookies.
 */

import { authService, AuthService } from './auth.ts';

function getClientIp(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

function parseJsonBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: any) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => {
      resolve({});
    });
  });
}

export function createAuthMiddleware(service: AuthService = authService) {
  return async (req: any, res: any, next: any) => {
    const urlPath = (req.url || '').split('?')[0];
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';
    const isHttps =
      req.headers['x-forwarded-proto'] === 'https' ||
      req.connection?.encrypted ||
      process.env.NODE_ENV === 'production';

    // 1. Session Status Endpoint
    if (urlPath === '/api/auth/session' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      const validation = service.validateSession(req.headers.cookie);
      if (validation.valid && validation.session) {
        res.end(
          JSON.stringify({
            authenticated: true,
            user: {
              username: validation.session.username,
              expiresAt: validation.session.expiresAt,
            },
          })
        );
      } else {
        res.end(JSON.stringify({ authenticated: false }));
      }
      return;
    }

    // 2. Login Endpoint
    if (urlPath === '/api/auth/login' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      const body = await parseJsonBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');

      // Check rate limits on IP and username
      const ipLimit = service.checkRateLimit(clientIp);
      const userLimit = username ? service.checkRateLimit(username) : ipLimit;

      if (!ipLimit.allowed || !userLimit.allowed) {
        const retryAfter = Math.max(ipLimit.retryAfterSec || 0, userLimit.retryAfterSec || 0) || 900;
        res.statusCode = 429;
        res.setHeader('Retry-After', String(retryAfter));
        res.end(
          JSON.stringify({
            success: false,
            error: `Too many failed login attempts. Access temporarily locked for ${Math.ceil(
              retryAfter / 60
            )} minute(s). Please try again later.`,
            retryAfter,
          })
        );
        return;
      }

      // Check credentials
      const expectedUsername = service.getAdminUsername();
      const isUsernameMatch = username === expectedUsername;
      const isPasswordMatch = isUsernameMatch ? await service.verifyPassword(password) : false;

      if (!isUsernameMatch || !isPasswordMatch) {
        service.recordFailedAttempt(clientIp);
        if (username) service.recordFailedAttempt(username);

        // Security constant-time delay against brute force
        await new Promise((r) => setTimeout(r, 350));

        res.statusCode = 401;
        res.end(
          JSON.stringify({
            success: false,
            error: 'Invalid administrator username or password',
          })
        );
        return;
      }

      // Successful login
      service.resetRateLimit(clientIp);
      service.resetRateLimit(username);

      const session = service.createSession(username, clientIp, userAgent);
      const cookieHeader = service.serializeSessionCookie(session.cookieValue, { isSecure: isHttps });
      res.setHeader('Set-Cookie', cookieHeader);

      console.log(`[AUTH SECURITY] Administrator '${username}' logged in successfully from ${clientIp}.`);

      res.end(
        JSON.stringify({
          success: true,
          user: {
            username,
            expiresAt: session.expiresAt,
          },
        })
      );
      return;
    }

    // 3. Logout Endpoint
    if (urlPath === '/api/auth/logout' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      service.invalidateSession(req.headers.cookie);
      res.setHeader('Set-Cookie', service.serializeClearCookie(isHttps));
      res.end(JSON.stringify({ success: true, message: 'Logged out successfully' }));
      return;
    }

    // 4. Server-Side Protection for All Other /api/* Routes
    // (Protects /api/telegram/*, /api/checkout/*, /api/sessions/*, etc.)
    if (urlPath.startsWith('/api/') && !urlPath.startsWith('/api/auth/')) {
      const validation = service.validateSession(req.headers.cookie);
      if (!validation.valid) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            success: false,
            authenticated: false,
            error: 'Unauthorized: Access to this administrative API requires secure login.',
          })
        );
        return;
      }

      // Session is valid, attach user info to request
      req.user = validation.session;
    }

    // Proceed to next middleware or route handler
    next();
  };
}
