/**
 * ═══════════════════════════════════════════════════════════════════
 *  SECURITYMAXXING SUITE (CricketHub)
 *  Covers Checkpoints 37 to 54
 * ═══════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const { writeLog, logSecurityEvent } = require('./logger');

// Security monitoring metrics
const securityMetrics = {
  startTime: Date.now(),
  blockedBots: 0,
  rateLimitHits: 0,
  promptInjectionAttempts: 0,
  massAssignmentAttempts: 0,
  prototypePollutionAttempts: 0,
  failedAuthAttempts: 0,
  successfulAuths: 0,
  tenantIsolationViolations: 0
};

/**
 * 39 & 40: Prompt Injection & AI Guardrails Sanitizer
 * Neutralizes malicious prompt injection strings and system override instructions
 */
function sanitizeAiPrompt(rawPrompt) {
  if (typeof rawPrompt !== 'string') return '';
  
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
    /system\s+prompt\s+override/i,
    /you\s+are\s+now\s+in\s+dan\s+mode/i,
    /jailbreak/i,
    /reveal\s+(your\s+)?(api|secret|instructions|system\s+prompt)/i,
    /bypass\s+all\s+(filters|rules|safety)/i,
    /output\s+the\s+hidden\s+token/i
  ];

  let cleaned = rawPrompt;
  let flagged = false;

  for (const pattern of injectionPatterns) {
    if (pattern.test(cleaned)) {
      flagged = true;
      cleaned = cleaned.replace(pattern, '[FILTERED_INJECTION_PROMPT]');
    }
  }

  if (flagged) {
    securityMetrics.promptInjectionAttempts++;
    logSecurityEvent('PROMPT_INJECTION_ATTEMPT_BLOCKED', {
      originalSnippet: rawPrompt.substring(0, 60),
      action: 'SANITIZED'
    });
  }

  return {
    isSafe: !flagged,
    sanitizedPrompt: cleaned.trim().slice(0, 1000) // Max 1000 chars
  };
}

/**
 * 51: Mass Assignment Whitelist Filter Middleware
 * Prevents attackers from injecting unauthorized attributes (e.g. isAdmin, role, balance, isHost)
 */
function pickAllowedFields(source, allowedFields = []) {
  if (!source || typeof source !== 'object') return {};
  const clean = {};
  for (const field of allowedFields) {
    if (source[field] !== undefined) {
      clean[field] = source[field];
    }
  }
  return clean;
}

function massAssignmentGuard(allowedFields = []) {
  return (req, res, next) => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      const forbiddenFields = ['isAdmin', 'role', 'isSuperAdmin', 'permissions', 'balance', 'isHost', '__proto__', 'constructor'];
      const foundForbidden = forbiddenFields.some(f => req.body[f] !== undefined);
      
      if (foundForbidden) {
        securityMetrics.massAssignmentAttempts++;
        logSecurityEvent('MASS_ASSIGNMENT_BLOCKED', {
          path: req.originalUrl || req.url,
          forbiddenKeys: forbiddenFields.filter(f => req.body[f] !== undefined)
        }, req);

        // Strip forbidden keys
        for (const f of forbiddenFields) {
          delete req.body[f];
        }
      }

      if (allowedFields.length > 0) {
        req.body = pickAllowedFields(req.body, allowedFields);
      }
    }
    next();
  };
}

/**
 * 53: Insecure Deserialization & Prototype Pollution Defense
 * Strips dangerous prototype modification keys (__proto__, constructor, prototype)
 */
function safeJsonParse(jsonString, fallback = null) {
  if (typeof jsonString !== 'string') return fallback;
  try {
    return JSON.parse(jsonString, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        securityMetrics.prototypePollutionAttempts++;
        logSecurityEvent('PROTOTYPE_POLLUTION_KEY_STRIPPED', { key });
        return undefined;
      }
      return value;
    });
  } catch (err) {
    return fallback;
  }
}

/**
 * 49: Multi-Tenant & Room Isolation Validator
 * Ensures users and sockets can only read and write to their joined room
 */
function verifyTenantIsolation(room, requestRoomCode, requestingUserPhone) {
  if (!room) {
    return { authorized: false, error: 'Room not found' };
  }
  if (room.code !== requestRoomCode) {
    securityMetrics.tenantIsolationViolations++;
    logSecurityEvent('TENANT_ISOLATION_VIOLATION', {
      expectedRoom: room.code,
      attemptedRoom: requestRoomCode,
      phone: requestingUserPhone
    });
    return { authorized: false, error: 'Cross-tenant room access violation.' };
  }
  return { authorized: true };
}

/**
 * 54: Timing-Safe String Comparison for Sensitive Tokens/OTPs
 */
function timingSafeEqual(strA, strB) {
  if (typeof strA !== 'string' || typeof strB !== 'string') return false;
  const bufA = Buffer.from(strA, 'utf8');
  const bufB = Buffer.from(strB, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 43: Get Real-Time Security Metrics
 */
function getSecurityMetrics() {
  const uptimeSec = Math.floor((Date.now() - securityMetrics.startTime) / 1000);
  return {
    status: 'OPTIMAL',
    uptimeSeconds: uptimeSec,
    ...securityMetrics
  };
}

module.exports = {
  sanitizeAiPrompt,
  pickAllowedFields,
  massAssignmentGuard,
  safeJsonParse,
  verifyTenantIsolation,
  timingSafeEqual,
  getSecurityMetrics,
  securityMetrics
};
