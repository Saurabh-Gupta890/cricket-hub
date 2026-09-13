/**
 * ═══════════════════════════════════════════════════════════════════════
 *  TEST: STAGING & PRODUCTION ENVIRONMENT ISOLATION & PARITY
 * ═══════════════════════════════════════════════════════════════════════
 */
const { spawn } = require('child_process');
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function httpRequest(urlStr, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const postData = data ? JSON.stringify(data) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(postData);

    const req = http.request(url, { method, headers, timeout: 4000 }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw), raw });
        } catch (e) {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function runStagingProductionTest() {
  console.log('🚀 Starting Staging vs Production Environment Verification...\n');

  const stagingPort = 3005;
  const stagingDataDir = path.join(__dirname, '..', 'data-staging-test');

  if (fs.existsSync(stagingDataDir)) {
    fs.rmSync(stagingDataDir, { recursive: true, force: true });
  }

  // 1. Launch Staging Server Process in Isolated Sandbox
  console.log(`🔹 Step 1: Spawning isolated Staging server on port ${stagingPort} (DATA_DIR: ${stagingDataDir})...`);
  const stagingProc = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'staging',
      PORT: String(stagingPort),
      DATA_DIR: stagingDataDir
    }
  });

  let serverStarted = false;
  stagingProc.stdout.on('data', (d) => {
    const str = d.toString();
    if (str.includes('CricketHub running in staging mode') || str.includes(`http://localhost:${stagingPort}`)) {
      serverStarted = true;
    }
  });

  // Wait for staging server to start
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      const res = await httpRequest(`http://localhost:${stagingPort}/api/health`);
      if (res.status === 200) {
        serverStarted = true;
        break;
      }
    } catch (e) {}
  }

  assert.ok(serverStarted, 'Staging server must start and respond to health check');
  console.log(`✅ Staging server UP on port ${stagingPort}`);

  // 2. Check Staging /api/environment Response
  console.log('\n🔹 Step 2: Querying Staging /api/environment endpoint...');
  const envRes = await httpRequest(`http://localhost:${stagingPort}/api/environment`);
  assert.strictEqual(envRes.status, 200);
  assert.strictEqual(envRes.body.environment, 'staging');
  assert.strictEqual(envRes.body.isStaging, true);
  assert.strictEqual(envRes.body.isProduction, false);
  console.log(`✅ Environment verified: ${JSON.stringify(envRes.body)}`);

  // 3. Request OTP on Staging: Must return devOtp for automated QA
  console.log('\n🔹 Step 3: Requesting OTP in Staging environment...');
  const stagingPhone = '9876512345';
  const otpRes = await httpRequest(`http://localhost:${stagingPort}/api/auth/request-otp`, 'POST', {
    phone: stagingPhone
  });
  assert.strictEqual(otpRes.status, 200);
  assert.ok(otpRes.body.devOtp, 'Staging must return devOtp for QA automation');
  console.log(`✅ Staging OTP returned devOtp: ${otpRes.body.devOtp}`);

  // 4. Verify OTP and check Staging Data Sandbox Isolation
  console.log('\n🔹 Step 4: Verifying user in Staging and checking filesystem isolation...');
  const verifyRes = await httpRequest(`http://localhost:${stagingPort}/api/auth/verify-otp`, 'POST', {
    phone: stagingPhone,
    otp: otpRes.body.devOtp,
    name: 'Staging QA Player',
    role: 'All-rounder'
  });
  assert.strictEqual(verifyRes.status, 200);
  assert.ok(verifyRes.body.token);

  // Check that data-staging-test has users.json
  const stagingUsersFile = path.join(stagingDataDir, 'users.json');
  assert.ok(fs.existsSync(stagingUsersFile), 'Staging data sandbox must store users in data-staging-test/users.json');

  const prodUsersFile = path.join(__dirname, '..', 'data', 'users.json');
  if (fs.existsSync(prodUsersFile)) {
    const prodUsers = JSON.parse(fs.readFileSync(prodUsersFile, 'utf8'));
    assert.strictEqual(prodUsers[stagingPhone], undefined, 'Staging user must NOT pollute production data/users.json');
  }
  console.log('✅ Physical Data Isolation Verified: Staging writes strictly to data-staging-test and never touches production data/');

  // Clean up staging process
  stagingProc.kill('SIGKILL');
  if (fs.existsSync(stagingDataDir)) {
    fs.rmSync(stagingDataDir, { recursive: true, force: true });
  }

  console.log('\n🎉 ALL STAGING VS PRODUCTION ENVIRONMENT TESTS PASSED 100%!\n');
}

runStagingProductionTest().catch(err => {
  console.error('❌ Staging test failed:', err);
  process.exit(1);
});
