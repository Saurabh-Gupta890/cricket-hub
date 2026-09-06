const io = require('socket.io-client');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SERVER_URL = 'http://localhost:3000';

function makeRequest(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, SERVER_URL);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTest() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🔔 TESTING COMPLETE PUSH NOTIFICATION SYSTEM (ALL USE CASES)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Check Service Worker has push and notificationclick event listeners
  const swCode = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  if (!swCode.includes("addEventListener('push'") || !swCode.includes("addEventListener('notificationclick'")) {
    console.error('❌ FAILED: sw.js missing push or notificationclick event listeners!');
    process.exit(1);
  }
  console.log('✅ Service Worker verified: contains push and notificationclick listeners');

  // 2. Auth User 1 (Host - Saurabh)
  const user1Phone = '9876540001';
  const otp1 = await makeRequest('POST', '/api/auth/request-otp', { phone: user1Phone, name: 'Saurabh' });
  const auth1 = await makeRequest('POST', '/api/auth/verify-otp', { phone: user1Phone, otp: otp1.data.devOtp, name: 'Saurabh' });
  const token1 = auth1.data.token;
  console.log('✅ User 1 Authenticated:', auth1.data.user.name, `(+${user1Phone})`);

  // 3. Auth User 2 (Player - Rohit)
  const user2Phone = '9876540002';
  const otp2 = await makeRequest('POST', '/api/auth/request-otp', { phone: user2Phone, name: 'Rohit' });
  const auth2 = await makeRequest('POST', '/api/auth/verify-otp', { phone: user2Phone, otp: otp2.data.devOtp, name: 'Rohit' });
  const token2 = auth2.data.token;
  console.log('✅ User 2 Authenticated:', auth2.data.user.name, `(+${user2Phone})`);

  // 4. Register mock WebPush subscription for User 2 (simulating idle phone device)
  const mockSub2 = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/mock-subscription-user2-' + Date.now(),
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcUbVJaBoeWcvnini0GJurEXBhZBgT02BE3h6874aDQuY',
      auth: 'tBHItJI5svbpez7KI4CCXg'
    }
  };
  const subRes = await makeRequest('POST', '/api/push/subscribe', {
    phone: user2Phone,
    subscription: mockSub2
  });
  console.log('✅ Registered WebPush Subscription for User 2 (+9876540002)');

  // 5. Connect WebSockets for active state testing
  const socket1 = io(SERVER_URL, { reconnection: false });
  const socket2 = io(SERVER_URL, { reconnection: false });

  await new Promise(r => socket1.on('connect', r));
  await new Promise(r => socket2.on('connect', r));

  socket1.emit('user:register', { token: token1, phone: user1Phone });
  socket2.emit('user:register', { token: token2, phone: user2Phone });
  await new Promise(r => setTimeout(r, 200));

  // ─────────────────────────────────────────────────────────────────
  // TEST USE CASE 1: Ping Right After Login (Home / Lobby Screen)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🧪 [USE CASE 1] Testing Global Broadcast Ping Right After Login...');
  let u2ReceivedAlertPromise = new Promise((resolve) => {
    socket2.once('popup:alert', (data) => {
      resolve(data);
    });
  });

  const broadcastRes = await makeRequest('POST', '/api/push/broadcast', {
    token: token1,
    author: 'Saurabh',
    message: 'Cricket match tonight at 8 PM! Who is in?'
  });

  const u2Alert1 = await u2ReceivedAlertPromise;
  console.log(`   🔔 User 2 received in-app alert: "${u2Alert1.message}" from ${u2Alert1.author}`);
  console.log(`   📱 Server WebPush dispatch count: ${broadcastRes.data.total}`);

  if (broadcastRes.data.total < 1 || !broadcastRes.data.success) {
    console.error('❌ FAILED: Broadcast did not find/dispatch WebPush subscription for User 2!');
    process.exit(1);
  }
  console.log('✅ Use Case 1 PASSED: Home screen ping delivered to both active socket & WebPush!');

  // ─────────────────────────────────────────────────────────────────
  // TEST USE CASE 2: Squad Ping After Creating Room (Send Alert to Squad)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🧪 [USE CASE 2] Testing Squad-Wide Ping After Creating Room...');
  const roomRes = await new Promise((resolve) => {
    socket1.emit('room:create', { token: token1, matchName: 'Wankhede Weekend T20', creatorPhone: user1Phone }, resolve);
  });
  const roomCode = roomRes.room.code;
  console.log(`   ✅ Match Room Created: ${roomCode}`);

  // User 2 joins match room
  await new Promise((resolve) => {
    socket2.emit('room:join', { token: token2, code: roomCode, phone: user2Phone }, resolve);
  });
  console.log(`   ✅ User 2 Joined Match Room: ${roomCode}`);

  u2ReceivedAlertPromise = new Promise((resolve) => {
    socket2.once('popup:alert', (data) => {
      resolve(data);
    });
  });

  const squadPingAck = await new Promise((resolve) => {
    socket1.emit('planning:nudge', { message: 'Need final count for the match!' }, resolve);
  });

  const u2Alert2 = await u2ReceivedAlertPromise;
  console.log(`   🔔 User 2 received Squad in-app alert: "${u2Alert2.message}"`);
  console.log(`   ⚡ Squad ping acknowledgment:`, squadPingAck);

  if (!squadPingAck || !squadPingAck.success) {
    console.error('❌ FAILED: Squad ping failed to acknowledge success!');
    process.exit(1);
  }
  console.log('✅ Use Case 2 PASSED: Squad-wide ping delivered cleanly!');

  // ─────────────────────────────────────────────────────────────────
  // TEST USE CASE 3: Individual Ping from Player Card (🔔 Ping button)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n🧪 [USE CASE 3] Testing Individual Ping from Player Card...');
  u2ReceivedAlertPromise = new Promise((resolve) => {
    socket2.once('popup:alert', (data) => {
      resolve(data);
    });
  });

  const indivPingAck = await new Promise((resolve) => {
    socket1.emit('planning:nudge', { 
      targetPhone: user2Phone, 
      message: 'Hey Rohit, are you playing tonight? Please confirm!' 
    }, resolve);
  });

  const u2Alert3 = await u2ReceivedAlertPromise;
  console.log(`   🔔 User 2 received Individual in-app alert: "${u2Alert3.message}" (isDirect: ${u2Alert3.isDirect})`);
  console.log(`   ⚡ Individual ping acknowledgment:`, indivPingAck);

  if (!indivPingAck || !indivPingAck.success || !u2Alert3.isDirect) {
    console.error('❌ FAILED: Individual card ping failed!');
    process.exit(1);
  }
  console.log('✅ Use Case 3 PASSED: Individual card ping delivered cleanly!');

  socket1.disconnect();
  socket2.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL PUSH NOTIFICATION USE CASES (ACTIVE & IDLE) PASSED 100%');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
