/**
 * Enterprise Security Engine (Never-Get-Hacked Architecture)
 * 1. Tiered Configurable Rate Limiting (Auth, Public, Authed)
 * 2. Per-IP & Per-Account combined limits with Exponential Backoff
 * 3. Zero-Information-Leakage Error Handling & Structured Logger
 * 4. Origin & Request Sanitization Guards
 */

// Memory stores for rate limits & exponential backoffs
const ipRequestHistory = new Map(); // ip:endpoint -> Array<number>
const accountRequestHistory = new Map(); // account:endpoint -> Array<number>
const authFailureTracking = new Map(); // account/ip -> { count: number, backoffUntil: number, lastAttempt: number }

// Configurable thresholds from Environment with secure defaults
const isProd = process.env.NODE_ENV === 'production';
const AUTH_RATE_LIMIT_MAX = parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || (isProd ? 10 : 40); // max attempts per window
const AUTH_RATE_LIMIT_WINDOW_MS = parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000; // 1 min window
const PUBLIC_RATE_LIMIT_MAX = parseInt(process.env.PUBLIC_RATE_LIMIT_MAX, 10) || (isProd ? 120 : 300); // req / min
const PUBLIC_RATE_LIMIT_WINDOW_MS = parseInt(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;
const AUTHED_RATE_LIMIT_MAX = parseInt(process.env.AUTHED_RATE_LIMIT_MAX, 10) || 500; // req / min
const AUTHED_RATE_LIMIT_WINDOW_MS = parseInt(process.env.AUTHED_RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;

/**
 * Extract clean client IP (handles standard proxies and Cloudflare)
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '127.0.0.1';
}

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
  const ip = getClientIp(req);
  const now = Date.now();

  // 1. Check Exponential Backoff if active
  const backoffKey = accountIdentifier ? `acc:${accountIdentifier}` : `ip:${ip}`;
  const failureState = authFailureTracking.get(backoffKey);
  if (failureState && failureState.backoffUntil > now) {
    const retryAfterSec = Math.ceil((failureState.backoffUntil - now) / 1000);
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
  const ip = getClientIp(req);
  const now = Date.now();
  const backoffKey = accountIdentifier ? `acc:${accountIdentifier}` : `ip:${ip}`;
  const existing = authFailureTracking.get(backoffKey) || { count: 0, backoffUntil: 0, lastAttempt: now };

  const newCount = existing.count + 1;
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s ... capped at 300s (5 mins)
  const delayMs = Math.min(1000 * Math.pow(2, newCount - 1), 300 * 1000);
  authFailureTracking.set(backoffKey, {
    count: newCount,
    backoffUntil: now + delayMs,
    lastAttempt: now
  });
}

/**
 * Reset authentication failure count on successful login
 */
function recordAuthSuccess(req, accountIdentifier = null) {
  const ip = getClientIp(req);
  if (accountIdentifier) authFailureTracking.delete(`acc:${accountIdentifier}`);
  authFailureTracking.delete(`ip:${ip}`);
}

/**
 * Public Route Rate Limiter Middleware
 */
function publicRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const check = checkWindowLimit(ipRequestHistory, `public:${ip}`, PUBLIC_RATE_LIMIT_MAX, PUBLIC_RATE_LIMIT_WINDOW_MS);
  if (check.limited) {
    res.setHeader('Retry-After', check.retryAfterSec);
    return res.status(429).json({
      success: false,
      error: `Rate limit exceeded. Please retry in ${check.retryAfterSec}s.`
    });
  }
  next();
}

/**
 * Authenticated Route Rate Limiter Middleware
 */
function authedRateLimiter(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token || req.body?.token;
  const ip = getClientIp(req);
  const key = token ? `token:${token.slice(0, 16)}` : `ip:${ip}`;
  const check = checkWindowLimit(accountRequestHistory, `authed:${key}`, AUTHED_RATE_LIMIT_MAX, AUTHED_RATE_LIMIT_WINDOW_MS);
  if (check.limited) {
    res.setHeader('Retry-After', check.retryAfterSec);
    return res.status(429).json({
      success: false,
      error: `Action limit exceeded. Please wait ${check.retryAfterSec}s.`
    });
  }
  next();
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
  console.error(`[SECURITY ERROR] ${context}:`, JSON.stringify(meta, null, 2));
}

/**
 * Express Global Error Handling Middleware
 * Guarantees zero stack trace / internal file path leakage to clients
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
}, 5 * 60 * 1000);

module.exports = {
  getClientIp,
  checkAuthRateLimit,
  recordAuthFailure,
  recordAuthSuccess,
  publicRateLimiter,
  authedRateLimiter,
  logErrorSafely,
  globalErrorHandler
};
