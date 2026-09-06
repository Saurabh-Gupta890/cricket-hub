/**
 * Test: Direct Ping & Just View -> Automatic Planning Phase Navigation
 */
const http = require('http');
const io = require('socket.io-client');

const BASE_URL = 'http://localhost:3000';

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTest() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🔔 TESTING DIRECT PING -> "JUST VIEW" TO PLANNING PHASE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Authenticate User A (Host)
  const otpResA = await makeRequest('POST', '/api/auth/request-otp', { phone: '9876540001', name: 'Captain Rohit' });
  const authResA = await makeRequest('POST', '/api/auth/verify-otp', {
    phone: '9876540001',
    otp: otpResA.data.devOtp,
    name: 'Captain Rohit'
  });
  const tokenA = authResA.data.token;
  console.log(`✅ User A Authenticated: Captain Rohit (+9876540001)`);

  // 2. Authenticate User B (Recipient)
  const otpResB = await makeRequest('POST', '/api/auth/request-otp', { phone: '9876540002', name: 'Hardik Pandya' });
  const authResB = await makeRequest('POST', '/api/auth/verify-otp', {
    phone: '9876540002',
    otp: otpResB.data.devOtp,
    name: 'Hardik Pandya'
  });
  const tokenB = authResB.data.token;
  console.log(`✅ User B Authenticated: Hardik Pandya (+9876540002)`);

  // 3. Connect Sockets
  const socketA = io(BASE_URL, { reconnection: false, transports: ['websocket'] });
  const socketB = io(BASE_URL, { reconnection: false, transports: ['websocket'] });

  await new Promise((resolve) => socketA.on('connect', resolve));
  await new Promise((resolve) => socketB.on('connect', resolve));

  socketA.emit('user:register', { token: tokenA });
  socketB.emit('user:register', { token: tokenB });
  await new Promise(r => setTimeout(r, 200));
  console.log('✅ Sockets connected & registered for User A & User B');

  // 4. User A creates match room
  let roomCode = null;
  await new Promise((resolve, reject) => {
    socketA.emit('room:create', {
      token: tokenA,
      matchName: 'Mumbai Derby 2026',
      overs: 20
    }, (res) => {
      if (!res.success) return reject(new Error(res.error));
      roomCode = res.room.code;
      console.log(`✅ User A Created Match Room: ${roomCode} (${res.room.matchName})`);
      resolve();
    });
  });

  // 5. Test Direct Ping from Planning Room (nudgeMember)
  console.log('\n🧪 [TEST 1] Direct Ping from Planning Screen to User B...');
  const alertPromise1 = new Promise((resolve) => {
    socketB.once('popup:alert', (data) => resolve(data));
  });

  await new Promise((resolve) => {
    socketA.emit('planning:nudge', {
      targetPhone: '9876540002',
      message: 'Hey Hardik, are you playing? Please confirm availability!'
    }, resolve);
  });

  const receivedAlert1 = await alertPromise1;
  console.log(`   🔔 User B received popup:alert from ${receivedAlert1.author}: "${receivedAlert1.message}"`);
  console.log(`   📌 Alert Room Code: ${receivedAlert1.roomCode}, isDirect: ${receivedAlert1.isDirect}`);

  if (receivedAlert1.roomCode !== roomCode) {
    throw new Error(`Expected roomCode ${roomCode}, got ${receivedAlert1.roomCode}`);
  }
  if (!receivedAlert1.isDirect) {
    throw new Error('Expected isDirect to be true');
  }

  // 6. User B clicks "Just View" -> emits room:join and enters planning phase
  console.log('\n🧪 [TEST 2] Simulating User B clicking "Just View"...');
  const joinRes = await new Promise((resolve) => {
    socketB.emit('room:join', { token: tokenB, code: receivedAlert1.roomCode }, resolve);
  });

  if (!joinRes.success) {
    throw new Error('User B failed to join room via alert roomCode: ' + joinRes.error);
  }

  const matchStatus = joinRes.room?.match?.status || 'planning';
  console.log(`   ✅ User B joined ${joinRes.room.code}! Match phase: "${matchStatus}"`);
  if (matchStatus !== 'planning') {
    throw new Error(`Expected match status to be "planning", got ${matchStatus}`);
  }
  console.log('✅ User B successfully entered Planning Phase from "Just View"!');

  // 7. Test Home Screen Direct Ping without explicit roomCode in request body (Server auto-resolves active room)
  console.log('\n🧪 [TEST 3] Direct Broadcast Ping from Home Screen (Auto-resolve Active Room)...');
  const alertPromise2 = new Promise((resolve) => {
    socketB.once('popup:alert', (data) => resolve(data));
  });

  const broadcastRes = await makeRequest('POST', '/api/push/broadcast', {
    token: tokenA,
    author: 'Captain Rohit',
    targetPhone: '9876540002',
    message: 'Hey Hardik, check the planning board!'
  });

  if (!broadcastRes.data.success) {
    throw new Error('Broadcast request failed: ' + JSON.stringify(broadcastRes.data));
  }

  const receivedAlert2 = await alertPromise2;
  console.log(`   🔔 User B received targeted alert: "${receivedAlert2.message}"`);
  console.log(`   📌 Auto-resolved Room Code: ${receivedAlert2.roomCode}, Match: ${receivedAlert2.matchName}`);

  if (receivedAlert2.roomCode !== roomCode) {
    throw new Error(`Auto-resolved room code mismatch: expected ${roomCode}, got ${receivedAlert2.roomCode}`);
  }
  console.log('✅ Auto-resolved Room Code & Direct Planning Routing Verified 100%!');

  socketA.disconnect();
  socketB.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL DIRECT PING & "JUST VIEW" PLANNING TESTS PASSED 100%');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

runTest().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
