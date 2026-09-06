/**
 * Test: Leave Joined Room Functionality
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
  console.log('🚪 TESTING LEAVE JOINED ROOM FEATURE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Auth User 1 (Host)
  const otp1 = await makeRequest('POST', '/api/auth/request-otp', { phone: '9876540001', name: 'Host Captain' });
  const auth1 = await makeRequest('POST', '/api/auth/verify-otp', { phone: '9876540001', otp: otp1.data.devOtp, name: 'Host Captain' });
  const token1 = auth1.data.token;
  console.log('✅ User 1 Authenticated (Host): Host Captain (+9876540001)');

  // 2. Auth User 2 (Squad Member)
  const otp2 = await makeRequest('POST', '/api/auth/request-otp', { phone: '9876540002', name: 'Player Two' });
  const auth2 = await makeRequest('POST', '/api/auth/verify-otp', { phone: '9876540002', otp: otp2.data.devOtp, name: 'Player Two' });
  const token2 = auth2.data.token;
  console.log('✅ User 2 Authenticated (Member): Player Two (+9876540002)');

  // 3. Connect Sockets
  const socket1 = io(BASE_URL, { reconnection: false, transports: ['websocket'] });
  const socket2 = io(BASE_URL, { reconnection: false, transports: ['websocket'] });

  if (!socket1.connected) await new Promise(r => socket1.once('connect', r));
  if (!socket2.connected) await new Promise(r => socket2.once('connect', r));

  socket1.emit('user:register', { token: token1, phone: '9876540001' });
  socket2.emit('user:register', { token: token2, phone: '9876540002' });
  await new Promise(r => setTimeout(r, 200));

  // 4. User 1 creates match room
  let roomCode = null;
  await new Promise((resolve, reject) => {
    socket1.emit('room:create', {
      token: token1,
      matchName: 'Championship Final',
      overs: 20
    }, (res) => {
      if (!res.success) return reject(new Error(res.error));
      roomCode = res.room.code;
      console.log(`✅ User 1 created room: ${roomCode}`);
      resolve();
    });
  });

  // 5. User 2 joins room
  await new Promise((resolve, reject) => {
    socket2.emit('room:join', { token: token2, code: roomCode }, (res) => {
      if (!res.success) return reject(new Error(res.error));
      console.log(`✅ User 2 joined room: ${roomCode}`);
      resolve();
    });
  });

  // Check 2 members
  const roomsBeforeRes = await makeRequest('POST', '/api/user/rooms', { token: token2, phone: '9876540002' });
  const hasRoomBefore = (roomsBeforeRes.data.rooms || []).some(r => r.code === roomCode);
  console.log(`   User 2 active rooms count: ${roomsBeforeRes.data.rooms?.length}, has ${roomCode}: ${hasRoomBefore}`);
  if (!hasRoomBefore) throw new Error('User 2 should have joined room in active list');

  // 6. User 2 leaves the room via socket
  console.log('\n🧪 [TEST 1] User 2 leaves room via socket "room:leave"...');
  const updatePromiseHost = new Promise((resolve) => {
    socket1.once('planning:update', (room) => resolve(room));
  });

  const leaveRes = await new Promise((resolve) => {
    socket2.emit('room:leave', { code: roomCode, token: token2 }, resolve);
  });

  if (!leaveRes?.success) throw new Error('Leave room failed: ' + JSON.stringify(leaveRes));
  console.log('   ✅ Socket leave response:', leaveRes);

  const updatedRoomOnHost = await updatePromiseHost;
  const remainingMembers = Object.keys(updatedRoomOnHost.planning?.members || {});
  console.log(`   📊 Host received planning:update! Remaining members: ${remainingMembers.length} (${remainingMembers.join(', ')})`);

  if (remainingMembers.length !== 1 || !remainingMembers[0].includes('9876540001')) {
    throw new Error(`Expected exactly Host member remaining, got ${JSON.stringify(remainingMembers)}`);
  }
  console.log('✅ User 2 removed from squad availability and host updated in real-time!');

  // 7. Verify User 2 rooms list no longer includes roomCode
  const roomsAfterRes = await makeRequest('POST', '/api/user/rooms', { token: token2, phone: '9876540002' });
  const hasRoomAfter = (roomsAfterRes.data.rooms || []).some(r => r.code === roomCode);
  console.log(`   User 2 active rooms count after leaving: ${roomsAfterRes.data.rooms?.length}, has ${roomCode}: ${hasRoomAfter}`);
  if (hasRoomAfter) throw new Error('User 2 should NOT have left room in active list');
  console.log('✅ User 2 active rooms list updated cleanly!');

  // 8. Test REST endpoint POST /api/rooms/leave
  console.log('\n🧪 [TEST 2] Testing REST endpoint POST /api/rooms/leave...');
  // User 2 rejoins first
  await new Promise((resolve) => socket2.emit('room:join', { token: token2, code: roomCode }, resolve));
  const restLeaveRes = await makeRequest('POST', '/api/rooms/leave', { code: roomCode, token: token2, phone: '9876540002' });
  if (!restLeaveRes.data.success) throw new Error('REST leave failed: ' + JSON.stringify(restLeaveRes.data));
  console.log('   ✅ REST leave response:', restLeaveRes.data);

  socket1.disconnect();
  socket2.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL LEAVE ROOM TESTS PASSED 100%');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

runTest().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
