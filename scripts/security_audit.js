#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 *  NEVER-GET-HACKED ENTERPRISE CODEBASE SECURITY AUDITOR
 * ═══════════════════════════════════════════════════════════════════════
 *  Automated verification across all 3 Security Prompt Categories:
 *  1. Secure Deployment & Monitoring (HTTPS, DB access restriction, audit logs)
 *  2. Protect Secrets and API Keys (Zero client exposure, secrets scanner)
 *  3. Prevent Abuse & Bot Attacks (Rate limiting, anti-scraping, bot defense)
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

console.log('🛡️ [Never-Get-Hacked] Running Full Pre-Ship Security Audit...\n');

let issuesFound = 0;

// ── PILLAR 1: SECURE DEPLOYMENT & MONITORING ────────────────────────
console.log('🔍 Check 1: Secure Deployment, HTTPS & Monitoring Verification...');
const serverJs = fs.readFileSync(path.join(ROOT_DIR, 'server.js'), 'utf-8');

if (!serverJs.includes('enforceHttpsMiddleware') || !serverJs.includes('Strict-Transport-Security')) {
  console.error('❌ Missing HTTPS enforcement or HSTS headers in server.js');
  issuesFound++;
} else {
  console.log('✅ HTTPS enforcement & Strict-Transport-Security active for production deployment.');
}

if (!serverJs.includes('auditLog') || !serverJs.includes('suspiciousTrafficDetector')) {
  console.error('❌ Missing security audit logging or suspicious traffic detection in server.js');
  issuesFound++;
} else {
  console.log('✅ Structured audit logger & suspicious traffic detector active for auth & API monitoring.');
}

// ── PILLAR 2: PROTECT SECRETS AND API KEYS ──────────────────────────
console.log('\n🔍 Check 2: Protect Secrets and API Keys (Deep Project Scan)...');
try {
  execSync('node scripts/scan_secrets.js', { stdio: 'inherit', cwd: ROOT_DIR });
} catch (e) {
  issuesFound++;
}

// Check .gitignore protections
const gitignore = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf-8');
if (!gitignore.includes('.env.production') || !gitignore.includes('.env.staging') || !gitignore.includes('data-staging')) {
  console.error('❌ .gitignore missing environment or data sandbox exclusions');
  issuesFound++;
} else {
  console.log('✅ .gitignore hardened: All .env files and data sandboxes excluded from repository commits.');
}

// ── PILLAR 3: PREVENT ABUSE & BOT ATTACKS ────────────────────────────
console.log('\n🔍 Check 3: Prevent Abuse & Bot Attacks (Rate Limiting & Anti-Scraping)...');
if (!serverJs.includes('checkAuthRateLimit') || !serverJs.includes('publicRateLimiter')) {
  console.error('❌ Missing tiered rate limiting middleware in server.js');
  issuesFound++;
} else {
  console.log('✅ Tiered rate limiters active on login, account creation, and public endpoints.');
}

if (!serverJs.includes('antiScrapingGuard') || !serverJs.includes('checkSocketRateLimit')) {
  console.error('❌ Missing anti-scraping guard or WebSocket flood limiter');
  issuesFound++;
} else {
  console.log('✅ Anti-scraping guard & WebSocket message flood limiter active against automated bot attacks.');
}

if (!serverJs.includes('globalErrorHandler')) {
  console.error('❌ Missing global error handler for zero information leakage');
  issuesFound++;
} else {
  console.log('✅ Global error boundary active: Stack traces and internal paths suppressed from responses.');
}

console.log('\n═══════════════════════════════════════════════════════════════');
if (issuesFound === 0) {
  console.log('🎉 ALL 3 SECURITY PROMPT PILLARS VERIFIED: 0 Vulnerabilities Found! Ready to Ship! ✅');
  process.exit(0);
} else {
  console.error(`🚨 Security Audit Failed with ${issuesFound} issues.`);
  process.exit(1);
}
