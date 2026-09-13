/**
 * ═══════════════════════════════════════════════════════════════════════
 *  TEST: 3 SECURITY PROMPTS (SCREENSHOT VERIFICATION SUITE)
 * ═══════════════════════════════════════════════════════════════════════
 *  Pillar 1: Secure Deployment & Monitoring
 *  Pillar 2: Protect Secrets and API Keys
 *  Pillar 3: Prevent Abuse & Bot Attacks
 * ═══════════════════════════════════════════════════════════════════════
 */
const http = require('http');
const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function httpRequest(endpoint, method = 'GET', data = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const postData = data ? JSON.stringify(data) : '';
    const headers = {
      'Content-Type': 'application/json',
      ...customHeaders
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(postData);

    const req = http.request(url, { method, headers, timeout: 5000 }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw), raw });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(postData);
    req.end();
  });
}

async function runScreenshotSecurityTests() {
  console.log('🛡️ Starting Screenshot Security Prompts Verification Suite...\n');

  // ── PILLAR 1: SECURE DEPLOYMENT & MONITORING ────────────────────────
  console.log('🔒 PILLAR 1: Verifying Secure Deployment, Monitoring & Headers...');
  const healthRes = await httpRequest('/api/health');
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.body.status, 'UP');
  assert.ok(healthRes.headers['x-content-type-options'], 'nosniff header must be set');
  assert.ok(healthRes.headers['x-frame-options'], 'SAMEORIGIN frame header must be set');
  console.log('✅ Health probe & enterprise transport security headers verified.');

  // Verify internal data/ is NOT exposed statically to public web requests
  const dataLeakRes = await httpRequest('/data/users.json');
  assert.strictEqual(dataLeakRes.status === 404 || dataLeakRes.status === 403, true, 'Internal database files must NOT be accessible statically');
  console.log('✅ Database access restricted from public web access (data/users.json is private).');

  // ── PILLAR 2: PROTECT SECRETS AND API KEYS ──────────────────────────
  console.log('\n🔑 PILLAR 2: Running Full Secrets & API Keys Scan...');
  try {
    execSync('node scripts/scan_secrets.js', { stdio: 'pipe', cwd: path.join(__dirname, '..') });
    console.log('✅ Secrets Scanner: Zero exposed credentials or keys in frontend bundles or repository files.');
  } catch (err) {
    console.error('❌ Secrets scanner reported an error:', err.stdout?.toString());
    throw new Error('Secrets scanner failed');
  }

  // ── PILLAR 3: PREVENT ABUSE & BOT ATTACKS ────────────────────────────
  console.log('\n🤖 PILLAR 3: Verifying Abuse Protection, Bot Defense & Rate Limiting...');
  
  // 1. Bot Probe Detection (Malicious User-Agent blocked)
  const botRes = await httpRequest('/api/health', 'GET', null, {
    'user-agent': 'sqlmap/1.4.7#stable (http://sqlmap.org)'
  });
  assert.strictEqual(botRes.status, 403, 'Malicious bot User-Agent must be blocked with HTTP 403');
  console.log('✅ Bot Protection: Automated scraper / malicious crawler blocked with HTTP 403.');

  // 2. Strict Schema Validation on Invalid Authentication
  const badPhoneRes = await httpRequest('/api/auth/request-otp', 'POST', { phone: '123' });
  assert.strictEqual(badPhoneRes.status, 400, 'Invalid phone must be rejected with HTTP 400');
  console.log('✅ Schema Validation: Invalid phone rejected with HTTP 400.');

  // 3. Exponential Backoff on Failed Authentication
  const testPhone = `98765${Math.floor(10000 + Math.random() * 90000)}`;
  const otpGen = await httpRequest('/api/auth/request-otp', 'POST', { phone: testPhone });
  assert.strictEqual(otpGen.status, 200);

  // Send bad OTP twice to trigger exponential backoff
  await httpRequest('/api/auth/verify-otp', 'POST', { phone: testPhone, otp: '000000' });
  const backoffRes = await httpRequest('/api/auth/verify-otp', 'POST', { phone: testPhone, otp: '000000' });
  assert.strictEqual(backoffRes.status, 429, 'Exponential backoff must return HTTP 429');
  console.log(`✅ Rate Limiting & Backoff: Exponential cooldown active on repeated login failures (HTTP 429).`);

  console.log('\n🎉 ALL 3 SECURITY PROMPT PILLARS VERIFIED AND PASSING 100%!\n');
}

runScreenshotSecurityTests().catch(err => {
  console.error('❌ Security Prompt Verification Failed:', err);
  process.exit(1);
});
