/**
 * ═══════════════════════════════════════════════════════════════════
 *  ENTERPRISE STRUCTURED LOGGING & LOG ROTATION ENGINE
 * ═══════════════════════════════════════════════════════════════════
 * Provides persistent, structured JSON logging with daily rotation,
 * correlation IDs (x-request-id), and automatic sensitive PII masking.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Masks sensitive PII (phone numbers, OTPs, tokens, passwords)
 */
function maskSensitiveData(data) {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(maskSensitiveData);

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (['otp', 'password', 'token', 'secret', 'vapid_private_key', 'authorization'].includes(lowerKey)) {
      clean[key] = '••••[REDACTED]••••';
    } else if (lowerKey.includes('phone') && typeof value === 'string') {
      const digits = value.replace(/\D/g, '');
      clean[key] = digits.length >= 4 ? `+${digits.slice(0, 2)}••••••${digits.slice(-2)}` : '••••';
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = maskSensitiveData(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Gets daily log file path
 */
function getDailyLogPath(category = 'app') {
  const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOGS_DIR, `${category}-${dateStr}.log`);
}

/**
 * Appends structured JSON log line to persistent daily file
 */
function writeLog(category, level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  const safeMeta = maskSensitiveData(metadata);
  
  const entry = {
    timestamp,
    level,
    category,
    message,
    ...safeMeta
  };

  const line = JSON.stringify(entry) + '\n';
  const filePath = getDailyLogPath(category);

  try {
    fs.appendFileSync(filePath, line, 'utf-8');
  } catch (err) {
    console.error(`Failed to write to log file ${filePath}:`, err);
  }

  // Also log to stdout in dev/staging with formatting
  const icon = level === 'ERROR' ? '🚨' : level === 'WARN' ? '⚠️' : level === 'SECURITY' ? '🛡️' : '📝';
  if (process.env.NODE_ENV !== 'production' || level === 'ERROR' || level === 'SECURITY') {
    console.log(`${icon} [${category.toUpperCase()}] ${message}:`, JSON.stringify(safeMeta));
  }
}

/**
 * Request Logging Middleware with Correlation ID
 */
function requestLoggerMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || `req_${crypto.randomBytes(8).toString('hex')}`;
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const startTime = Date.now();
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    
    // Log API access
    writeLog('http', level, `${req.method} ${req.originalUrl || req.url} -> ${res.statusCode}`, {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      ip,
      userAgent: req.headers['user-agent']
    });
  });

  next();
}

/**
 * Dedicated Security Audit Logger
 */
function logSecurityEvent(eventType, metadata = {}, req = null) {
  const extra = req ? {
    requestId: req.requestId,
    ip: req.headers?.['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1',
    userAgent: req.headers?.['user-agent'],
    path: req.originalUrl || req.url
  } : {};

  writeLog('security', 'SECURITY', eventType, {
    eventType,
    ...extra,
    ...metadata
  });
}

module.exports = {
  LOGS_DIR,
  maskSensitiveData,
  writeLog,
  requestLoggerMiddleware,
  logSecurityEvent
};
