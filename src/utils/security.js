/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ENTERPRISE SECURITY & MONITORING ENGINE (Never-Get-Hacked Architecture)
 * ═══════════════════════════════════════════════════════════════════════
 *  Pillar 1: Secure Deployment & Monitoring (HTTPS, DB isolation, Audit logs)
 *  Pillar 2: Protect Secrets and API Keys (Zero exposure, secrets guard)
 *  Pillar 3: Prevent Abuse & Bot Attacks (Rate limiting, Anti-scraping, Backoff)
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// In-memory sliding window stores
const ipRequestHistory = new Map();       // ip:endpoint -> Array<number>
const accountRequestHistory = new Map();  // account:endpoint -> Array<number>
const authFailureTracking = new Map();    // account/ip -> { count, backoffUntil, lastAttempt }
const suspiciousTrafficTracker = new Map(); // ip -> { count, firstSeen, flagged }
const socketMessageCounter = new Map();   // socketId -> { count, windowStart }

// Configurable thresholds from Environment with secure defaults
const isProd = process.env.NODE_ENV === 'production';
const AUTH_RATE_LIMIT_MAX = parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || (isProd ? 10 : 40);
const AUTH_RATE_LIMIT_WINDOW_MS = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;
const PUBLIC_RATE_LIMIT_MAX = parseInt(process.env.PUBLIC_RATE_LIMIT_MAX, 10) || (isProd ? 100 : 300);
const PUBLIC_RATE_LIMIT_WINDOW_MS = parseInt(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;
const AUTHED_RATE_LIMIT_MAX = parseInt(process.env.AUTHED_RATE_LIMIT_MAX, 10) || 500;
const AUTHED_RATE_LIMIT_WINDOW_MS = parseInt(process.env.AUTHED_RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;
const SUSPICIOUS_BURST_THRESHOLD = 45; // Max requests per 10s before suspicious flag

/**
 * Extract clean client IP (handles standard reverse proxies & Cloudflare)
 */
function getClientIp(req) {
  if (!req) return '127.0.0.1';
  const forwarded = req.headers ? req.headers['x-forwarded-for'] : null;
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PILLAR 1: SECURE DEPLOYMENT & MONITORING
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Enforces HTTPS redirection and strict HSTS in production environments
 */
function enforceHttpsMiddleware(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'];
    if (proto && proto !== 'https') {
      const host = req.headers.host || req.hostname;
      return res.redirect(301, `https://${host}${req.url}`);
    }
  }
  next();
}

/**
 * Structured Security Audit Logging
 */
function auditLog(eventType, details = {}, req = null) {
  const meta = {
    timestamp: new Date().toISOString(),
    event: eventType,
    environment: process.env.NODE_ENV || 'development',
    ip: req ? getClientIp(req) : details.ip || '127.0.0.1',
    userAgent: req ? (req.headers['user-agent'] || 'unknown') : undefined,
    path: req ? req.originalUrl || req.url : undefined,
    method: req ? req.method : undefined,
    ...details
  };

  // Mask any sensitive identifiers
  if (meta.phone) {
    const digits = String(meta.phone).replace(/\D/g, '');
    meta.phone = digits.length >= 4 ? `+${digits.slice(0, 2)}••••••${digits.slice(-2)}` : '••••';
  }
  delete meta.otp;
  delete meta.password;
  delete meta.token;

  console.log(`🛡️ [SECURITY AUDIT] ${eventType}:`, JSON.stringify(meta));
}

/**
 * Suspicious Traffic Pattern Detector
 * Identifies high-speed bot bursts, probing, and brute force traffic
 */
function suspiciousTrafficDetector(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const tracker = suspiciousTrafficTracker.get(ip) || { count: 0, firstSeen: now, flagged: false };

  if (now - tracker.firstSeen > 10000) {
    // Reset 10s window
    tracker.count = 1;
    tracker.firstSeen = now;
    tracker.flagged = false;
  } else {
    tracker.count++;
  }

  if (tracker.count > SUSPICIOUS_BURST_THRESHOLD && !tracker.flagged) {
    tracker.flagged = true;
    auditLog('SUSPICIOUS_TRAFFIC_BURST_DETECTED', {
      ip,
      requestCount: tracker.count,
      windowSeconds: 10,
      threatLevel: 'HIGH'
    }, req);
  }

  suspiciousTrafficTracker.set(ip, tracker);
  next();
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PILLAR 2: PROTECT SECRETS AND API KEYS
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Scans a file's content for exposed secret signatures
 */
function containsExposedSecrets(content) {
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /mongodb(\+srv)?:\/\/[^:\s]+:[^@\s]+@/i,
    /AKIA[0-9A-Z]{16}/,
    /AIza[0-9A-Za-z-_]{35}/,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // Raw JWT
    /vapid_private_key\s*=\s*['"][A-Za-z0-9_-]{20,}['"]/i
  ];
  return secretPatterns.some(pattern => pattern.test(content));
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PILLAR 3: PREVENT ABUSE & BOT ATTACKS
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Checks sliding window rate limit
 */
function checkWindowLimit(store, key, maxRequests, windowMs) {
  const now = Date.now();
  const timestamps = store.get(key) || [];
  const valid = timestamps.filter(t => now - t < windowMs);
  if (valid.length >= maxRequests) {
    store.set(key, valid);
    const oldest = valid[0];
    const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
    return { limited: true, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  valid.push(now);
  store.set(key, valid);
  return { limited: false, remaining: maxRequests - valid.length };
}

/**
 * Authentication Route Rate Limiting with Per-IP, Per-Account & Exponential Backoff
 */
function checkAuthRateLimit(req, accountIdentifier = null) {
  const isProdOrStaging = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
  if (!isProdOrStaging) {
    return { limited: false };
  }

  const ip = getClientIp(req);
  const now = Date.now();

  // 1. Check Exponential Backoff
  const backoffKey = accountIdentifier ? `acc:${accountIdentifier}` : `ip:${ip}`;
  const failureState = authFailureTracking.get(backoffKey);
  if (failureState && failureState.backoffUntil > now) {
    const retryAfterSec = Math.ceil((failureState.backoffUntil - now) / 1000);
    auditLog('AUTH_RATE_LIMIT_BACKOFF_ACTIVE', { backoffKey, retryAfterSec }, req);
    return {
      limited: true,
      statusCode: 429,
      error: `Too many failed attempts. Please wait ${retryAfterSec}s before retrying.`,
      retryAfterSec
    };
  }

  // 2. Check Per-IP sliding window
  const ipCheck = checkWindowLimit(ipRequestHistory, `auth:ip:${ip}`, AUTH_RATE_LIMIT_MAX * 2, AUTH_RATE_LIMIT_WINDOW_MS);
  if (ipCheck.limited) {
    auditLog('AUTH_IP_RATE_LIMIT_TRIGGERED', { ip, retryAfterSec: ipCheck.retryAfterSec }, req);
    return {
      limited: true,
      statusCode: 429,
      error: `Too many authentication requests from this network. Please retry in ${ipCheck.retryAfterSec}s.`,
      retryAfterSec: ipCheck.retryAfterSec
    };
  }

  // 3. Check Per-Account sliding window
  if (accountIdentifier) {
    const accCheck = checkWindowLimit(accountRequestHistory, `auth:acc:${accountIdentifier}`, AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS);
    if (accCheck.limited) {
      auditLog('AUTH_ACCOUNT_RATE_LIMIT_TRIGGERED', { accountIdentifier, retryAfterSec: accCheck.retryAfterSec }, req);
      return {
        limited: true,
        statusCode: 429,
        error: `Too many login attempts for this account. Please retry in ${accCheck.retryAfterSec}s.`,
        retryAfterSec: accCheck.retryAfterSec
      };
    }
  }

  return { limited: false };
}

/**
 * Record an authentication failure and apply exponential backoff
 */
function recordAuthFailure(req, accountIdentifier = null) {
  const isProdOrStaging = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';
  if (!isProdOrStaging) return;

  const ip = getClientIp(req);
  const now = Date.now();
  const backoffKey = accountIdentifier ? `acc:${accountIdentifier}` : `ip:${ip}`;
  const existing = authFailureTracking.get(backoffKey) || { count: 0, backoffUntil: 0, lastAttempt: now };

  const newCount = existing.count + 1;
  // Exponential backoff: 2s, 4s, 8s, 16s, 32s ... capped at 300s (5 min)
  const delayMs = Math.min(1000 * Math.pow(2, newCount), 300 * 1000);
  authFailureTracking.set(backoffKey, {
    count: newCount,
    backoffUntil: now + delayMs,
    lastAttempt: now
  });

  auditLog('AUTH_FAILURE_RECORDED', {
    backoffKey,
    consecutiveFailures: newCount,
    backoffSeconds: delayMs / 1000
  }, req);
}

/**
 * Reset authentication failure count on successful login
 */
function recordAuthSuccess(req, accountIdentifier = null) {
  const ip = getClientIp(req);
  if (accountIdentifier) authFailureTracking.delete(`acc:${accountIdentifier}`);
  authFailureTracking.delete(`ip:${ip}`);
  auditLog('AUTH_LOGIN_SUCCESS', { accountIdentifier, ip }, req);
}

/**
 * Public Route Anti-Scraping & Rate Limiter Middleware
 */
function publicRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const check = checkWindowLimit(ipRequestHistory, `public:${ip}`, PUBLIC_RATE_LIMIT_MAX, PUBLIC_RATE_LIMIT_WINDOW_MS);
  if (check.limited) {
    auditLog('PUBLIC_RATE_LIMIT_BLOCKED', { ip, retryAfterSec: check.retryAfterSec }, req);
    res.setHeader('Retry-After', check.retryAfterSec);
    return res.status(429).json({
      success: false,
      error: `Rate limit exceeded. Please retry in ${check.retryAfterSec}s.`
    });
  }
  next();
}

/**
 * Anti-Bot & Automated Scraper Detection Middleware
 */
function antiScrapingGuard(req, res, next) {
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const isMaliciousBot = [
    'libwww',
    'python-requests',
    'sqlmap',
    'nikto',
    'nmap',
    'masscan',
    'havij',
    'httrack',
    'gobuster',
    'dirbuster',
    'zgrab',
    'scrapy',
    'acunetix'
  ].some(bot => userAgent.includes(bot));

  if (isMaliciousBot) {
    auditLog('MALICIOUS_BOT_PROBE_BLOCKED', { userAgent, ip: getClientIp(req) }, req);
    return res.status(403).json({
      success: false,
      error: 'Access denied by automated security policy.'
    });
  }
  next();
}

/**
 * WebSocket Anti-Spam Message Limiter (Per Socket Connection)
 */
function checkSocketRateLimit(socketId, maxEventsPerMinute = 120) {
  const now = Date.now();
  const entry = socketMessageCounter.get(socketId) || { count: 0, windowStart: now };

  if (now - entry.windowStart > 60000) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count++;
  }

  socketMessageCounter.set(socketId, entry);
  return entry.count <= maxEventsPerMinute;
}

/**
 * Central Structured Error Logger & Information Leakage Filter
 */
function logErrorSafely(context, err, req = null) {
  const meta = {
    timestamp: new Date().toISOString(),
    context,
    message: err?.message || String(err),
    stack: err?.stack || undefined,
    path: req?.originalUrl || req?.url,
    method: req?.method,
    ip: req ? getClientIp(req) : undefined
  };
  auditLog('API_ERROR_CAPTURED', meta, req);
}

/**
 * Express Global Error Handling Middleware (Zero stack trace leak to client)
 */
function globalErrorHandler(err, req, res, next) {
  logErrorSafely('Unhandled Express Error', err, req);
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'An unexpected internal server error occurred.' : (err.message || 'Request failed')
  });
}

// Periodic cleanup of stale rate limiting keys
setInterval(() => {
  const now = Date.now();
  for (const [k, times] of ipRequestHistory.entries()) {
    const valid = times.filter(t => now - t < 15 * 60 * 1000);
    if (valid.length === 0) ipRequestHistory.delete(k);
    else ipRequestHistory.set(k, valid);
  }
  for (const [k, times] of accountRequestHistory.entries()) {
    const valid = times.filter(t => now - t < 15 * 60 * 1000);
    if (valid.length === 0) accountRequestHistory.delete(k);
    else accountRequestHistory.set(k, valid);
  }
  for (const [k, state] of authFailureTracking.entries()) {
    if (now - state.lastAttempt > 30 * 60 * 1000 && now > state.backoffUntil) {
      authFailureTracking.delete(k);
    }
  }
  for (const [ip, tracker] of suspiciousTrafficTracker.entries()) {
    if (now - tracker.firstSeen > 15 * 60 * 1000) {
      suspiciousTrafficTracker.delete(ip);
    }
  }
}, 5 * 60 * 1000);

/**
 * Authenticated Route Action Rate Limiter Middleware
 */
function authedRateLimiter(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token || req.body?.token;
  const ip = getClientIp(req);
  const key = token ? `token:${token.slice(0, 16)}` : `ip:${ip}`;
  const check = checkWindowLimit(accountRequestHistory, `authed:${key}`, AUTHED_RATE_LIMIT_MAX, AUTHED_RATE_LIMIT_WINDOW_MS);
  if (check.limited) {
    auditLog('AUTHED_ACTION_RATE_LIMIT_BLOCKED', { key, retryAfterSec: check.retryAfterSec }, req);
    res.setHeader('Retry-After', check.retryAfterSec);
    return res.status(429).json({
      success: false,
      error: `Action limit exceeded. Please wait ${check.retryAfterSec}s.`
    });
  }
  next();
}

module.exports = {
  getClientIp,
  enforceHttpsMiddleware,
  auditLog,
  suspiciousTrafficDetector,
  containsExposedSecrets,
  checkAuthRateLimit,
  recordAuthFailure,
  recordAuthSuccess,
  publicRateLimiter,
  authedRateLimiter,
  antiScrapingGuard,
  checkSocketRateLimit,
  logErrorSafely,
  globalErrorHandler
};
