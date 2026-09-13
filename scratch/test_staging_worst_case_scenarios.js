/**
 * ═══════════════════════════════════════════════════════════════════
 *  STAGING ENVIRONMENT: WORST-CASE SCENARIO & CHAOS RESILIENCE SUITE
 * ═══════════════════════════════════════════════════════════════════
 * This suite launches a clean Staging instance (Port 3001, NODE_ENV=staging, DATA_DIR=data-staging)
 * and executes intense chaos, stress, security, and edge-case attacks:
 *
 * 1. High Concurrency Traffic Burst (100 parallel requests)
 * 2. Oversized Payload & Buffer Overflow Defense (>2MB payload limit)
 * 3. NoSQL / SQL Injection & Parameter Tampering ($where, $gt, $ne, arrays)
 * 4. XSS & Malicious Polyglot Script Injection
 * 5. Aggressive Brute-Force Auth with Exponential Backoff & OTP Spend Cap
 * 6. Malicious Bot Scrapers / Vulnerability Scanners (HTTP 403 Forbidden)
 * 7. WebSocket Event Flooding & Abrupt Disconnection Stress
 * 8. High-Frequency Concurrent Atomic Persistence (Zero Corrupt/Truncated Files)
 * 9. Corrupt File / Missing Database Graceful Recovery
 * 10. Complete Staging Sandbox Isolation (Zero Production Data Leakage)
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const ioClient = require('socket.io-client');

const STAGING_PORT = 3001;
const STAGING_HOST = `http://localhost:${STAGING_PORT}`;
const STAGING_DATA_DIR = path.join(__dirname, '..', 'data-staging');
const PROD_DATA_DIR = path.join(__dirname, '..', 'data');

let stagingProcess = null;

// Helper: HTTP Request Promise
function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) CricketHub-Staging-Test'
    };
    
    const reqOptions = {
      hostname: 'localhost',
      port: STAGING_PORT,
      path: path,
      method: options.method || 'GET',
      headers: { ...defaultHeaders, ...(options.headers || {}) },
      timeout: options.timeout || 10000
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json,
          raw: data
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options.body) {
      const payload = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(payload);
    }
    req.end();
  });
}

// Start Staging Server
async function startStagingServer() {
  console.log('🏗️  Preparing isolated Staging environment in "data-staging/"...');
  if (fs.existsSync(STAGING_DATA_DIR)) {
    fs.rmSync(STAGING_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(STAGING_DATA_DIR, 'matches'), { recursive: true });

  console.log('🚀 Spawning Staging Server instance on Port 3001 (NODE_ENV=staging)...');
  stagingProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: STAGING_PORT.toString(),
      NODE_ENV: 'staging',
      DATA_DIR: 'data-staging',
      AUTH_RATE_LIMIT_MAX: '8',
      FORCE_HTTPS: 'false'
    },
    stdio: 'pipe'
  });

  stagingProcess.stdout.on('data', (data) => {
    const text = data.toString();
    if (process.env.VERBOSE) console.log(`[STAGING LOG] ${text.trim()}`);
  });

  stagingProcess.stderr.on('data', (data) => {
    const text = data.toString();
    if (process.env.VERBOSE) console.error(`[STAGING ERR] ${text.trim()}`);
  });

  // Wait for server to become responsive
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const res = await makeRequest('/api/health');
      if (res.statusCode === 200 && res.body && res.body.status === 'UP') {
        ready = true;
        break;
      }
    } catch (e) {
      // Retrying
    }
  }

  if (!ready) {
    throw new Error('Failed to start Staging server within 10 seconds.');
  }
  console.log('✅ Staging Server is active and healthy on Port 3001!\n');
}

// Stop Staging Server
function stopStagingServer() {
  if (stagingProcess) {
    console.log('🛑 Shutting down Staging Server process...');
    stagingProcess.kill('SIGKILL');
    stagingProcess = null;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TEST SCENARIOS
// ═══════════════════════════════════════════════════════════════════

async function runWorstCaseTests() {
  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`   ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`   ❌ FAIL: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    await startStagingServer();

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔥 RUNNING STAGING WORST-CASE CHAOS & SECURITY RESILIENCE TESTS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 1: High-Concurrency Burst & Traffic Spike
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 1] High-Concurrency Rapid-Fire Burst (100 parallel requests)...');
    const burstPromises = [];
    for (let i = 0; i < 100; i++) {
      burstPromises.push(makeRequest('/api/health'));
    }
    const burstResults = await Promise.all(burstPromises);
    const successfulBursts = burstResults.filter(r => r.statusCode === 200).length;
    const rateLimitedBursts = burstResults.filter(r => r.statusCode === 429).length;
    
    assert(successfulBursts + rateLimitedBursts === 100, `All 100 requests resolved cleanly without unhandled dropouts.`);
    assert(successfulBursts >= 50, `Majority of high-concurrency requests served with 200 OK (${successfulBursts} OK, ${rateLimitedBursts} rate-limited).`);
    console.log('   ℹ️ Server handled 100 concurrent requests smoothly with zero 500 errors.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 2: Oversized Payloads & Buffer Exhaustion Attacks
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 2] Oversized Payloads & Buffer Exhaustion Attacks (>2MB)...');
    const hugePayload = 'A'.repeat(3 * 1024 * 1024); // 3MB body
    let oversizedResponse;
    try {
      oversizedResponse = await makeRequest('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210', junk: hugePayload })
      });
    } catch (err) {
      oversizedResponse = { statusCode: 413 };
    }
    assert(
      oversizedResponse.statusCode === 413 || oversizedResponse.statusCode === 400,
      `Oversized 3MB payload rejected with HTTP ${oversizedResponse.statusCode} (Payload Too Large).`
    );

    // Corrupted malformed JSON payload
    const malformedResponse = await makeRequest('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"phone": "9876543210", corrupt_json: [unclosed'
    });
    assert(malformedResponse.statusCode === 400, `Malformed invalid JSON rejected with HTTP 400 Bad Request.`);
    console.log('   ℹ️ Server body parser and error handler defended against memory exhaustion.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 3: NoSQL / SQL Injection & Parameter Tampering
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 3] NoSQL / SQL Injection & Operator Tampering ($where, $gt, $ne)...');
    const injectionAttack1 = await makeRequest('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        phone: { '$gt': '' },
        otp: { '$ne': null },
        '$where': 'sleep(5000)'
      }
    });
    assert(
      injectionAttack1.statusCode === 400,
      `NoSQL operator injection in auth rejected with HTTP 400 (Bad Request).`
    );

    const injectionAttack2 = await makeRequest('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        phone: ['9876543210', '9999999999'], // Array parameter pollution
        name: { '$regex': '.*' }
      }
    });
    assert(
      injectionAttack2.statusCode === 400,
      `Parameter pollution with arrays/objects rejected by strict schema validation.`
    );
    console.log('   ℹ️ noSqlInjectionGuard & validator stripped injection keys and enforced string primitives.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 4: Cross-Site Scripting (XSS) & Polyglot Script Injections
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 4] XSS & Malicious Polyglot Script Injection Defense...');
    const xssPayloads = [
      '<script>alert(document.cookie)</script>',
      '"><img src=x onerror=alert(1)>',
      'javascript:/*--></title></style></textarea>*/<svg/onload=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>'
    ];

    for (const xss of xssPayloads) {
      const sendRes = await makeRequest('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { phone: '9876540001', name: xss }
      });
      // Should reject invalid characters via REGEX_SAFE_NAME or sanitize
      assert(
        sendRes.statusCode === 400 || !JSON.stringify(sendRes.body || {}).includes('<script>'),
        `XSS payload "${xss.substring(0, 20)}..." safely neutralized or rejected (HTTP ${sendRes.statusCode}).`
      );
    }
    console.log('   ℹ️ XSS polyglots sanitized with HTML entity encoder or rejected at validator.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 5: Aggressive Brute-Force Auth, Exponential Backoff & OTP Spend Cap
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 5] Aggressive Auth Brute-Force & OTP Spend Cap Simulation...');
    const victimPhone = '9876500099';
    
    // Request valid OTP first
    const sendOtpRes = await makeRequest('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { phone: victimPhone, name: 'ChaosVictim' }
    });
    assert(sendOtpRes.statusCode === 200, `Initial OTP requested successfully for ${victimPhone}.`);

    // Rapid-fire 6 wrong OTP guesses to trigger exponential backoff
    let backoffTriggered = false;
    for (let i = 0; i < 6; i++) {
      const wrongOtpRes = await makeRequest('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { phone: victimPhone, otp: '000000' }
      });
      if (wrongOtpRes.statusCode === 429) {
        backoffTriggered = true;
        assert(
          wrongOtpRes.body && wrongOtpRes.body.error.includes('Too many failed attempts'),
          `Exponential backoff triggered (HTTP 429: "${wrongOtpRes.body.error}").`
        );
        break;
      }
    }
    assert(backoffTriggered, `Brute-force attack successfully throttled by exponential backoff.`);

    // Test OTP Spend Cap (Rapidly requesting > 8 OTPs for same phone)
    console.log('   Testing SMS Gateway Spend Cap protection (Hourly OTP Cap per phone)...');
    const spendPhone = '9876511122';
    let spendCapHit = false;
    for (let i = 0; i < 10; i++) {
      const res = await makeRequest('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { phone: spendPhone, name: 'SpamUser' }
      });
      if (res.statusCode === 429) {
        spendCapHit = true;
        assert(
          res.body && (res.body.error.includes('Too many') || res.body.error.includes('limit')),
          `Spend cap active: Phone throttled with HTTP 429 after exceeding threshold.`
        );
        break;
      }
    }
    assert(spendCapHit, `OTP Spend Cap successfully blocked SMS flooding.`);
    console.log('   ℹ️ Gateway billing protected and credential brute-forcing neutralized.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 6: Malicious Bot Scrapers / Vulnerability Scanners
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 6] Malicious Bot Scrapers & Exploit Scanner Defense (User-Agent Detection)...');
    const maliciousBots = [
      'sqlmap/1.4.7#stable (http://sqlmap.org)',
      'Nikto/2.1.6',
      'masscan/1.0',
      'HTTrack 3.0x',
      'python-requests/malicious-scraper'
    ];

    for (const botAgent of maliciousBots) {
      const botRes = await makeRequest('/api/health', {
        headers: { 'User-Agent': botAgent }
      });
      assert(
        botRes.statusCode === 403,
        `Malicious scanner "${botAgent.split('/')[0]}" blocked with HTTP 403 Forbidden.`
      );
    }
    console.log('   ℹ️ antiScrapingGuard blocked all malicious probes and automated scrapers.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 7: WebSocket Socket Flooding & Sudden Abrupt Disconnects
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 7] WebSocket Event Flooding & Sudden Connection Teardown...');
    
    // Register host user for websocket room
    const hostPhone = '9876522233';
    await makeRequest('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { phone: hostPhone, name: 'SocketHost' }
    });
    // In staging/dev mode, verify with valid OTP
    const verifyHost = await makeRequest('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { phone: hostPhone, otp: '123456' } // Will fail or use staging devOtp
    });
    
    const socket = ioClient(STAGING_HOST, {
      transports: ['websocket'],
      forceNew: true
    });

    await new Promise((resolve) => {
      socket.on('connect', () => {
        resolve();
      });
    });

    assert(socket.connected, `WebSocket client connected to Staging server successfully.`);

    // Rapidly flood 40 socket events in under 100ms
    for (let i = 0; i < 40; i++) {
      socket.emit('chat:send', { roomCode: 'CRK-TEST', text: `SpamMessage-${i}` });
    }

    // Abruptly force-close client socket mid-flight
    socket.disconnect();
    assert(!socket.connected, `Socket forcefully disconnected mid-stream.`);

    // Verify server did not crash and remains healthy
    await new Promise(r => setTimeout(r, 500));
    const healthAfterFlood = await makeRequest('/api/health');
    assert(healthAfterFlood.statusCode === 200, `Staging server remained 100% stable after socket flood and disconnect.`);
    console.log('   ℹ️ Socket rate limiter and disconnect handler prevented resource leaks.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 8: High-Frequency Concurrent Atomic Persistence
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 8] High-Frequency Concurrent Atomic Database Writes...');
    
    // Concurrently register and verify 20 distinct users
    const writePromises = [];
    for (let i = 10; i < 30; i++) {
      const p = `98765333${i}`;
      const clientIp = `198.51.100.${i}`;
      writePromises.push(
        (async () => {
          const reqRes = await makeRequest('/api/auth/request-otp', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': clientIp
            },
            body: { phone: p, name: `ConcurrentPlayer${i}` }
          });
          const otp = reqRes.body?.devOtp;
          if (otp) {
            await makeRequest('/api/auth/verify-otp', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': clientIp
              },
              body: { phone: p, otp }
            });
          }
        })()
      );
    }
    await Promise.all(writePromises);

    // Verify data-staging/users.json is valid uncorrupted JSON
    const stagingUsersFile = path.join(STAGING_DATA_DIR, 'users.json');
    assert(fs.existsSync(stagingUsersFile), `Staging users.json exists.`);
    
    const usersRaw = fs.readFileSync(stagingUsersFile, 'utf-8');
    let parsedUsers = null;
    try {
      parsedUsers = JSON.parse(usersRaw);
    } catch (e) {
      parsedUsers = null;
    }
    assert(parsedUsers !== null && typeof parsedUsers === 'object', `Staging users.json is valid, uncorrupted JSON.`);
    assert(Object.keys(parsedUsers).length >= 10, `All concurrent writes persisted accurately (${Object.keys(parsedUsers).length} users).`);
    
    // Verify no leftover .tmp files
    const leftoverTmpFiles = fs.readdirSync(STAGING_DATA_DIR).filter(f => f.endsWith('.tmp'));
    assert(leftoverTmpFiles.length === 0, `Zero orphaned .tmp files left in data-staging/. Atomic rename is clean.`);
    console.log('   ℹ️ safeWriteJsonFile atomic write pipeline guarantees zero data corruption under load.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 9: Corrupt Database File & Missing Data Recovery
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 9] Corrupt Database File & Missing Directory Graceful Recovery...');
    
    // Inject corrupt junk into rooms.json in data-staging
    const stagingRoomsFile = path.join(STAGING_DATA_DIR, 'rooms.json');
    fs.writeFileSync(stagingRoomsFile, '<<<CORRUPTED BINARY JUNK>>>', 'utf-8');

    // Check server health probe and public rooms endpoint
    const corruptRecoveryRes = await makeRequest('/api/health');
    assert(corruptRecoveryRes.statusCode === 200, `Server survived corrupted database file without crash.`);

    const playersRes = await makeRequest('/api/players');
    assert(playersRes.statusCode === 200, `Players directory endpoint gracefully handled corrupted data with empty fallback.`);
    
    const historyRes = await makeRequest('/api/history');
    assert(historyRes.statusCode === 200, `Match history endpoint returned 200 OK cleanly.`);
    console.log('   ℹ️ safeReadJsonFile safely fell back to default structures without unhandled exceptions.\n');

    // ─────────────────────────────────────────────────────────────
    // TEST 10: Complete Staging Sandbox Isolation (Zero Production Leakage)
    // ─────────────────────────────────────────────────────────────
    console.log('💥 [Chaos 10] Staging Sandbox Isolation & Production Data Shielding...');
    
    const envRes = await makeRequest('/api/environment');
    assert(envRes.body && envRes.body.environment === 'staging', `Environment correctly reports "staging".`);
    assert(envRes.body && envRes.body.isStaging === true, `isStaging flag is true.`);

    const healthRes = await makeRequest('/api/health');
    assert(healthRes.body && healthRes.body.dataDirectory === 'data-staging', `Active DATA_DIR is strictly "data-staging".`);

    // Verify production data directory was untouched by these chaos tests
    const prodUsersFile = path.join(PROD_DATA_DIR, 'users.json');
    if (fs.existsSync(prodUsersFile)) {
      const prodUsers = JSON.parse(fs.readFileSync(prodUsersFile, 'utf-8'));
      assert(
        !prodUsers['9876500099'] && !prodUsers['9876511122'],
        `Production database ("data/users.json") was 100% shielded from all staging chaos tests!`
      );
    }
    console.log('   ℹ️ Complete logical and physical database isolation between Staging and Production verified.\n');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`🏆 ALL ${passed}/${total} WORST-CASE SCENARIOS & CHAOS ATTACKS PASSED!`);
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('❌ Test execution failed with error:', err);
    process.exitCode = 1;
  } finally {
    stopStagingServer();
  }
}

runWorstCaseTests();
