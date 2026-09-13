/**
 * Strict Schema Input Validation Engine
 * Enforces strict type, length, format, and value boundaries.
 * Rejects invalid inputs with HTTP 400 instead of silent truncation.
 */

const { normalizePhone } = require('./phoneUtils');

const REGEX_PHONE = /^[0-9]{8,15}$/;
const REGEX_OTP = /^[0-9]{6}$/;
const REGEX_ROOM_CODE = /^CRK-[A-Z0-9]{4}$/i;
const REGEX_GROUP_CODE = /^GRP-[A-Z0-9]{4,10}$/i;
const REGEX_SAFE_NAME = /^[\p{L}\p{N}\s\-_.,'#()@&/]{1,60}$/u;

function validatePhone(phone) {
  if (typeof phone !== 'string' && typeof phone !== 'number') {
    return { valid: false, error: 'Phone number must be a string or number' };
  }
  const clean = normalizePhone(phone);
  if (!REGEX_PHONE.test(clean)) {
    return { valid: false, error: 'Phone number must contain between 8 and 15 digits' };
  }
  return { valid: true, value: clean };
}

function validateOtp(otp) {
  if (typeof otp !== 'string' && typeof otp !== 'number') {
    return { valid: false, error: 'OTP must be a 6-digit numeric string' };
  }
  const str = String(otp).trim();
  if (!REGEX_OTP.test(str)) {
    return { valid: false, error: 'OTP must be exactly 6 numeric digits' };
  }
  return { valid: true, value: str };
}

function validateRoomCode(code) {
  if (typeof code !== 'string') {
    return { valid: false, error: 'Room code must be a string' };
  }
  const upper = code.trim().toUpperCase();
  if (!REGEX_ROOM_CODE.test(upper)) {
    return { valid: false, error: 'Room code must match format CRK-XXXX' };
  }
  return { valid: true, value: upper };
}

function validateGroupCode(code) {
  if (typeof code !== 'string') {
    return { valid: false, error: 'Squad code must be a string' };
  }
  const upper = code.trim().toUpperCase();
  if (!REGEX_GROUP_CODE.test(upper)) {
    return { valid: false, error: 'Squad code must match format GRP-XXXX' };
  }
  return { valid: true, value: upper };
}

function validateText(str, { min = 1, max = 100, field = 'Text', required = true, pattern = null } = {}) {
  if (str === undefined || str === null || str === '') {
    if (!required) return { valid: true, value: '' };
    return { valid: false, error: `${field} is required` };
  }
  if (typeof str !== 'string') {
    return { valid: false, error: `${field} must be a string` };
  }
  const trimmed = str.trim();
  if (required && trimmed.length < min) {
    return { valid: false, error: `${field} must be at least ${min} characters long` };
  }
  if (trimmed.length > max) {
    return { valid: false, error: `${field} cannot exceed ${max} characters` };
  }
  if (pattern && !pattern.test(trimmed)) {
    return { valid: false, error: `${field} contains disallowed special characters` };
  }
  return { valid: true, value: trimmed };
}

function validateInteger(val, { min = 0, max = 10000, field = 'Value', required = true } = {}) {
  if (val === undefined || val === null) {
    if (!required) return { valid: true, value: null };
    return { valid: false, error: `${field} is required` };
  }
  const num = Number(val);
  if (!Number.isInteger(num) || Number.isNaN(num)) {
    return { valid: false, error: `${field} must be a valid whole number` };
  }
  if (num < min || num > max) {
    return { valid: false, error: `${field} must be between ${min} and ${max}` };
  }
  return { valid: true, value: num };
}

function validateEnum(val, allowedValues, field = 'Field') {
  if (!allowedValues.includes(val)) {
    return { valid: false, error: `${field} must be one of: ${allowedValues.join(', ')}` };
  }
  return { valid: true, value: val };
}

/**
 * Express middleware helper to strictly validate request bodies against rules
 */
function validateRequestBody(schema) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, error: 'Invalid request body format. JSON object required.' });
    }
    for (const [field, rule] of Object.entries(schema)) {
      const val = req.body[field];
      const result = rule(val);
      if (!result.valid) {
        return res.status(400).json({ success: false, error: result.error, field });
      }
      req.body[field] = result.value;
    }
    next();
  };
}

/**
 * XSS HTML Entity Sanitizer
 */
function sanitizeHtmlXss(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * NoSQL Injection Sanitizer: Strips operator keys ($where, $gt, $ne, etc.)
 */
function sanitizeNoSqlInjection(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeNoSqlInjection);
  
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      continue;
    }
    clean[key] = sanitizeNoSqlInjection(value);
  }
  return clean;
}

/**
 * NoSQL Injection Protection Middleware
 */
function noSqlInjectionGuard(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeNoSqlInjection(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeNoSqlInjection(req.query);
  }
  next();
}

/**
 * Secure File / Image Avatar Upload Validator
 */
function validateAvatarUpload(avatar) {
  if (!avatar || typeof avatar !== 'string') return { valid: true, value: '🏏' };
  const trimmed = avatar.trim();
  if (trimmed.length > 500000) {
    return { valid: false, error: 'Avatar image file cannot exceed 500KB.' };
  }
  if (trimmed.startsWith('data:image/')) {
    const isSafeImage = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(trimmed);
    if (!isSafeImage) {
      return { valid: false, error: 'Invalid or unsupported image file format.' };
    }
  }
  return { valid: true, value: trimmed };
}

module.exports = {
  validatePhone,
  validateOtp,
  validateRoomCode,
  validateGroupCode,
  validateText,
  validateInteger,
  validateEnum,
  validateRequestBody,
  sanitizeHtmlXss,
  sanitizeNoSqlInjection,
  noSqlInjectionGuard,
  validateAvatarUpload,
  REGEX_SAFE_NAME
};
