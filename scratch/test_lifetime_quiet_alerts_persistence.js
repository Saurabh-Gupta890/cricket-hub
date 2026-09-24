/**
 * ═══════════════════════════════════════════════════════════════════════
 *  TEST: LIFETIME PERSISTENCE OF PAUSE / QUIET ALERTS
 * ═══════════════════════════════════════════════════════════════════════
 */
const http = require('http');
const ioClient = require('socket.io-client');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function httpRequest(method, endpoint, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const postData = data ? JSON.stringify(data) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(postData);

    const req = http.request(url, { method, headers, timeout: 5000 }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const body = raw ? JSON.parse(raw) : null;
          resolve({ status: res.statusCode, body, raw });
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

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event '${event}'`));
    }, timeoutMs);

    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function runLifetimeQuietAlertsTest() {
  console.log('🔕 Starting Lifetime Quiet Alerts Persistence Verification...\n');

  // 1. Authenticate Host and Player
  const hostPhone = `98765${Math.floor(10000 + Math.random() * 90000)}`;
  const p2Phone = `98765${Math.floor(10000 + Math.random() * 90000)}`;

  const hostOtpRes = await httpRequest('POST', '/api/auth/request-otp', { phone: hostPhone });
  const hostAuth = await httpRequest('POST', '/api/auth/verify-otp', {
    phone: hostPhone,
    otp: hostOtpRes.body.devOtp,
    name: 'Host Captain',
    role: 'Top-order Batter'
  });
  const hostToken = hostAuth.body.token;

  const p2OtpRes = await httpRequest('POST', '/api/auth/request-otp', { phone: p2Phone });
  const p2Auth = await httpRequest('POST', '/api/auth/verify-otp', {
    phone: p2Phone,
    otp: p2OtpRes.body.devOtp,
    name: 'Player 2',
    role: 'Bowler'
  });
  const p2Token = p2Auth.body.token;

  const socket1 = ioClient(BASE_URL, { reconnection: false });
  const socket2 = ioClient(BASE_URL, { reconnection: false });

  await Promise.all([
    new Promise(res => socket1.on('connect', res)),
    new Promise(res => socket2.on('connect', res))
  ]);

  socket1.emit('user:register', { token: hostToken, phone: hostPhone });
  socket2.emit('user:register', { token: p2Token, phone: p2Phone });

  // 2. Create Room
  const createRes = await new Promise((res) => {
    socket1.emit('room:create', { token: hostToken, matchName: 'Quiet Mode Lifetime Test ' + Date.now() }, res);
  });
  const roomCode = createRes?.room?.code || createRes?.existingRoomCode;
  assert.ok(roomCode);
  console.log(`✅ Room created: ${roomCode}`);

  await new Promise((res) => {
    socket2.emit('room:join', { token: p2Token, code: roomCode }, res);
  });
  console.log(`✅ Player 2 joined room ${roomCode}`);

  // 3. Host turns Pause / Quiet Alerts ON
  console.log('\n🔕 Step 1: Host turns Quiet Alerts ON...');
  const setQuietRes = await new Promise((res) => {
    socket1.emit('room:setQuietAlerts', { enabled: true }, res);
  });
  assert.strictEqual(setQuietRes.success, true);
  assert.strictEqual(setQuietRes.quietAlerts, true);
  console.log('✅ Host set quietAlerts = true');

  // 4. Verify in data/rooms.json file on disk
  console.log('\n💾 Step 2: Verifying persistence in data/rooms.json...');
  const roomsJsonPath = path.join(__dirname, '..', 'data', 'rooms.json');
  const roomsData = JSON.parse(fs.readFileSync(roomsJsonPath, 'utf8'));
  assert.ok(roomsData[roomCode], `Room ${roomCode} must exist in rooms.json`);
  assert.strictEqual(roomsData[roomCode].quietAlerts, true, 'quietAlerts MUST be true in rooms.json');
  console.log(`✅ Verified: room ${roomCode} has quietAlerts: true saved on disk in rooms.json!`);

  // 5. Verify host default preference in data/users.json
  const usersJsonPath = path.join(__dirname, '..', 'data', 'users.json');
  const usersData = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
  const cleanHost = hostPhone.replace(/\D/g, '');
  assert.ok(usersData[cleanHost] || usersData[hostPhone], 'Host user must exist in users.json');
  const hostEntry = usersData[cleanHost] || usersData[hostPhone];
  assert.strictEqual(hostEntry.defaultQuietAlerts, true, 'Host profile must remember defaultQuietAlerts = true');
  console.log('✅ Verified: Host user profile stored defaultQuietAlerts: true');

  // 6. Test that Pings/Nudges are strictly paused
  console.log('\n🚫 Step 3: Verifying that squad alerts are blocked while Quiet Mode is ON...');
  const nudgeRes = await new Promise((res) => {
    socket1.emit('planning:nudge', { message: 'Are you coming?' }, res);
  });
  assert.strictEqual(nudgeRes.success, false);
  assert.strictEqual(nudgeRes.quiet, true);
  console.log('✅ Squad alert successfully blocked with quiet: true');

  // 7. Verify match:reset preserves quietAlerts
  console.log('\n🔄 Step 4: Resetting match state and verifying quietAlerts survives...');
  const resetRes = await new Promise((res) => {
    socket1.emit('match:reset', res);
  });
  assert.strictEqual(resetRes.success, true);
  assert.strictEqual(resetRes.room.quietAlerts, true, 'quietAlerts must remain true after match:reset');
  console.log('✅ quietAlerts remained TRUE after match:reset');

  // 8. Verify rematch preserves quietAlerts
  console.log('\n🔄 Step 5: Triggering rematch and verifying quietAlerts survives...');
  const rematchRes = await new Promise((res) => {
    socket1.emit('match:rematch', { resetToSetup: true }, res);
  });
  assert.strictEqual(rematchRes.success, true);

  const roomsDataAfterRematch = JSON.parse(fs.readFileSync(roomsJsonPath, 'utf8'));
  assert.strictEqual(roomsDataAfterRematch[roomCode].quietAlerts, true);
  console.log('✅ quietAlerts remained TRUE on disk after match:rematch');

  // 9. Host turns Quiet Alerts OFF
  console.log('\n🔔 Step 6: Host explicitly turns Quiet Alerts OFF...');
  const setOffRes = await new Promise((res) => {
    socket1.emit('room:setQuietAlerts', { enabled: false }, res);
  });
  assert.strictEqual(setOffRes.success, true);
  assert.strictEqual(setOffRes.quietAlerts, false);

  const roomsDataAfterOff = JSON.parse(fs.readFileSync(roomsJsonPath, 'utf8'));
  assert.strictEqual(roomsDataAfterOff[roomCode].quietAlerts, false);
  console.log('✅ Quiet Alerts successfully deactivated by host and saved on disk');

  socket1.disconnect();
  socket2.disconnect();

  console.log('\n🎉 ALL LIFETIME QUIET ALERTS PERSISTENCE TESTS PASSED 100%!\n');
  process.exit(0);
}

runLifetimeQuietAlertsTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
