const http = require('http');
const { io } = require('socket.io-client');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          resolve(buf);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function testAlertDelivery() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('⚡ TESTING ALERT DELIVERY FROM HOST TO USERS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Host logs in
  const otpRes1 = await post('/api/auth/request-otp', { phone: '9876540001', name: 'Captain Virat' });
  const auth1 = await post('/api/auth/verify-otp', { phone: '9876540001', otp: otpRes1.devOtp });
  const hostToken = auth1.token;

  // 2. User 2 (Rohit) logs in and connects
  const otpRes2 = await post('/api/auth/request-otp', { phone: '9876540002', name: 'Rohit Sharma' });
  const auth2 = await post('/api/auth/verify-otp', { phone: '9876540002', otp: otpRes2.devOtp });
  const userToken = auth2.token;

  const hostSocket = io('http://localhost:3000', { transports: ['websocket'] });
  const userSocket = io('http://localhost:3000', { transports: ['websocket'] });

  await Promise.all([
    new Promise(r => hostSocket.on('connect', r)),
    new Promise(r => userSocket.on('connect', r))
  ]);

  // Register user socket
  userSocket.emit('user:register', { phone: '9876540002', name: 'Rohit Sharma', token: userToken });

  // Create match room
  const roomRes = await new Promise(resolve => {
    hostSocket.emit('room:create', { token: hostToken, matchName: 'Alert Test Cup' }, resolve);
  });
  const roomCode = roomRes.room.code;
  console.log(`✅ Room created: ${roomCode}`);

  // User joins room
  await new Promise(resolve => {
    userSocket.emit('room:join', { token: userToken, code: roomCode }, resolve);
  });

  // 3. Test Broadcast Alert API
  console.log('\n🧪 1. Testing /api/push/broadcast from Host...');
  const broadcastRes = await post('/api/push/broadcast', {
    token: hostToken,
    author: 'Captain Virat',
    message: 'Match starting in 30 mins! Confirm RSVP.'
  });
  console.log('   Broadcast response:', broadcastRes);
  if (!broadcastRes.success) throw new Error('Broadcast returned success: false!');
  if (broadcastRes.success === 0) throw new Error('Broadcast returned success: 0 instead of true!');
  console.log('   ✅ Broadcast returned clean success: true');

  // 4. Test planning:nudge via Socket
  console.log('\n🧪 2. Testing planning:nudge from Host to Squad...');
  let receivedAlert = null;
  userSocket.on('popup:alert', (data) => {
    receivedAlert = data;
    console.log(`   🔔 User received popup:alert from ${data.author}: "${data.message}"`);
  });

  const nudgeRes = await new Promise(resolve => {
    hostSocket.emit('planning:nudge', { message: 'Need final count now!' }, resolve);
  });
  console.log('   Nudge callback response:', nudgeRes);

  await new Promise(r => setTimeout(r, 600));

  if (!receivedAlert) throw new Error('User socket did not receive popup:alert!');
  console.log('   ✅ Alert received on user device successfully!');

  hostSocket.disconnect();
  userSocket.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALERT DELIVERY TEST FULLY PASSED (100%)');
  console.log('═══════════════════════════════════════════════════════════════════');
}

testAlertDelivery().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
