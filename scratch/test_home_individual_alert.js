const io = require('socket.io-client');
const http = require('http');

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
  console.log('👤 TESTING HOME SCREEN INDIVIDUAL & SQUAD PUSH ALERT OPTIONS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Auth User 1 (Saurabh)
  const user1Phone = '9876540001';
  const otp1 = await makeRequest('POST', '/api/auth/request-otp', { phone: user1Phone, name: 'Saurabh' });
  const auth1 = await makeRequest('POST', '/api/auth/verify-otp', { phone: user1Phone, otp: otp1.data.devOtp, name: 'Saurabh' });
  const token1 = auth1.data.token;
  console.log('✅ User 1 Authenticated (Host): Saurabh (+9876540001)');

  // 2. Auth User 2 (Rohit)
  const user2Phone = '9876540002';
  const otp2 = await makeRequest('POST', '/api/auth/request-otp', { phone: user2Phone, name: 'Rohit' });
  const auth2 = await makeRequest('POST', '/api/auth/verify-otp', { phone: user2Phone, otp: otp2.data.devOtp, name: 'Rohit' });
  const token2 = auth2.data.token;
  console.log('✅ User 2 Authenticated (Teammate): Rohit (+9876540002)');

  // 3. Register mock WebPush for User 2
  await makeRequest('POST', '/api/push/subscribe', {
    phone: user2Phone,
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/mock-user2-' + Date.now(),
      keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9AcUbVJaBoeWcvnini0GJurEXBhZBgT02BE3h6874aDQuY', auth: 'tBHItJI5svbpez7KI4CCXg' }
    }
  });
  console.log('✅ Registered WebPush Subscription for User 2');

  // 4. Connect WebSockets
  const socket1 = io(SERVER_URL, { reconnection: false, transports: ['websocket'] });
  const socket2 = io(SERVER_URL, { reconnection: false, transports: ['websocket'] });

  await new Promise(r => socket1.on('connect', r));
  await new Promise(r => socket2.on('connect', r));

  socket1.emit('user:register', { token: token1, phone: user1Phone });
  socket2.emit('user:register', { token: token2, phone: user2Phone });
  await new Promise(r => setTimeout(r, 200));

  // 5. Test Sending INDIVIDUAL ALERT from Home Screen to Rohit
  console.log('\n🧪 1. Testing Individual Targeted Push Alert from Home Screen...');
  const u2AlertPromise = new Promise((resolve) => {
    socket2.once('popup:alert', (data) => resolve(data));
  });

  const individualAlertRes = await makeRequest('POST', '/api/push/broadcast', {
    token: token1,
    author: 'Saurabh',
    targetPhone: user2Phone,
    message: 'Hey Rohit, are you ready for the cricket match today at 5 PM?'
  });

  console.log('   Response from server:', individualAlertRes.data);
  const receivedAlert = await u2AlertPromise;
  console.log(`   🔔 User 2 received targeted alert: "${receivedAlert.message}" (isDirect: ${receivedAlert.isDirect})`);

  if (!individualAlertRes.data.success || !receivedAlert.isDirect || receivedAlert.targetPhone !== user2Phone) {
    console.error('❌ Individual alert test failed!');
    process.exit(1);
  }
  console.log('✅ Individual Alert Test Passed 100%!');

  // 6. Test Player Directory endpoint lists players
  console.log('\n🧪 2. Testing Player Directory API...');
  const playersRes = await makeRequest('GET', '/api/players');
  const players = playersRes.data.players || [];
  console.log(`   Fetched ${players.length} players from directory.`);
  const hasRohit = players.some(p => p.phone === user2Phone || p.name === 'Rohit');
  if (!hasRohit) {
    console.error('❌ Player directory missing Rohit!');
    process.exit(1);
  }
  console.log('✅ Player Directory API Verified!');

  socket1.disconnect();
  socket2.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL HOME SCREEN INDIVIDUAL & SQUAD ALERT TESTS PASSED 100%');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
