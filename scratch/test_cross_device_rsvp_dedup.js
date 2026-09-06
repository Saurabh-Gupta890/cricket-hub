const io = require('socket.io-client');
const http = require('http');

const SERVER_URL = 'http://localhost:3000';

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
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

function phonesMatch(p1, p2) {
  if (!p1 || !p2) return false;
  const s1 = String(p1).replace(/\D/g, '');
  const s2 = String(p2).replace(/\D/g, '');
  if (s1 === s2) return true;
  if (s1.length >= 10 && s2.length >= 10) {
    return s1.slice(-10) === s2.slice(-10);
  }
  return false;
}

function getDeduplicatedPlanningMembers(planning) {
  const raw = Object.values(planning?.members || {});
  const unique = [];
  for (const m of raw) {
    if (!m) continue;
    const exists = unique.find(u => phonesMatch(u.phone, m.phone));
    if (exists) {
      if (!exists.vote && m.vote) exists.vote = m.vote;
      if (!exists.comment && m.comment) exists.comment = m.comment;
      if (m.isOnline) exists.isOnline = true;
      if (m.isHost) exists.isHost = true;
    } else {
      unique.push({ ...m });
    }
  }
  return unique;
}

async function runTest() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('👥 TESTING CROSS-DEVICE MULTI-LOGIN RSVP DEDUPLICATION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Auth Phone Host
  const hostPhone = '9876540001';
  const otpRes = await makeRequest('POST', '/api/auth/request-otp', { phone: hostPhone, name: 'Captain Virat' });
  const verifyRes = await makeRequest('POST', '/api/auth/verify-otp', { phone: hostPhone, otp: otpRes.data.devOtp, name: 'Captain Virat' });
  const phoneToken = verifyRes.data.token;
  console.log('✅ Phone Host Authenticated:', verifyRes.data.user.name, `(+${verifyRes.data.user.phone})`);

  // 2. Auth Laptop (Same Phone Number, with +91 prefix format)
  const laptopPhone = '+919876540001';
  const otpRes2 = await makeRequest('POST', '/api/auth/request-otp', { phone: laptopPhone, name: 'Captain Virat' });
  const verifyRes2 = await makeRequest('POST', '/api/auth/verify-otp', { phone: laptopPhone, otp: otpRes2.data.devOtp, name: 'Captain Virat' });
  const laptopToken = verifyRes2.data.token;
  console.log('✅ Laptop Host Authenticated (Same User):', verifyRes2.data.user.name, `(+${verifyRes2.data.user.phone})`);

  // 3. Connect Phone Socket and create room
  const phoneSocket = io(SERVER_URL, { reconnection: false });
  const laptopSocket = io(SERVER_URL, { reconnection: false });

  await new Promise(r => phoneSocket.on('connect', r));
  await new Promise(r => laptopSocket.on('connect', r));

  phoneSocket.emit('auth:register', { token: phoneToken, phone: hostPhone });
  laptopSocket.emit('auth:register', { token: laptopToken, phone: laptopPhone });
  await new Promise(r => setTimeout(r, 200));

  // Phone creates room
  const roomRes = await new Promise((resolve) => {
    phoneSocket.emit('room:create', { token: phoneToken, matchName: 'Wankhede T20 Derby', creatorPhone: hostPhone }, resolve);
  });
  const roomCode = roomRes.room.code;
  console.log(`✅ Room Created on Phone: ${roomCode}`);

  // Phone puts status as 'coming'
  const voteRes1 = await new Promise((resolve) => {
    phoneSocket.emit('planning:vote', { vote: 'coming', comment: 'Ready on mobile!' }, resolve);
  });
  console.log('✅ Phone Host set status: COMING');

  // Laptop joins the same room
  const joinRes = await new Promise((resolve) => {
    laptopSocket.emit('room:join', { token: laptopToken, code: roomCode, phone: laptopPhone }, resolve);
  });
  console.log('✅ Laptop Host joined room:', roomCode);

  // Laptop puts status as 'coming' as well
  const voteRes2 = await new Promise((resolve) => {
    laptopSocket.emit('planning:vote', { vote: 'coming', comment: 'Ready on laptop too!' }, resolve);
  });
  console.log('✅ Laptop Host set status: COMING');

  // Verify server public state
  const updatedRoom = voteRes2.room;
  const serverMembers = Object.values(updatedRoom.planning.members);
  const dedupMembers = getDeduplicatedPlanningMembers(updatedRoom.planning);

  const comingCount = dedupMembers.filter(m => m.vote === 'coming').length;
  console.log(`\n📊 Verification Results:`);
  console.log(`   Total Server Members: ${serverMembers.length}`);
  console.log(`   Deduplicated Members: ${dedupMembers.length}`);
  console.log(`   Coming Count: ${comingCount} (Expected: 1)`);

  if (comingCount !== 1) {
    console.error(`❌ FAILED: Coming count is ${comingCount}, expected 1!`);
    process.exit(1);
  }
  if (dedupMembers.length !== 1) {
    console.error(`❌ FAILED: Total member cards is ${dedupMembers.length}, expected 1!`);
    process.exit(1);
  }

  // 4. Test vote change synchronization from laptop to 'maybe'
  const voteRes3 = await new Promise((resolve) => {
    laptopSocket.emit('planning:vote', { vote: 'maybe', comment: 'Might be delayed 10m' }, resolve);
  });
  const maybeMembers = getDeduplicatedPlanningMembers(voteRes3.room.planning);
  const maybeCount = maybeMembers.filter(m => m.vote === 'maybe').length;
  const newComingCount = maybeMembers.filter(m => m.vote === 'coming').length;

  console.log(`\n🧪 Vote Change from Laptop Sync Test:`);
  console.log(`   Maybe Count: ${maybeCount} (Expected: 1)`);
  console.log(`   Coming Count: ${newComingCount} (Expected: 0)`);

  if (maybeCount !== 1 || newComingCount !== 0) {
    console.error(`❌ FAILED: Vote change sync failed!`);
    process.exit(1);
  }

  // 5. Test another different user joining (Rohit Sharma)
  const user2Phone = '9876540002';
  const u2Otp = await makeRequest('POST', '/api/auth/request-otp', { phone: user2Phone, name: 'Rohit Sharma' });
  const u2Verify = await makeRequest('POST', '/api/auth/verify-otp', { phone: user2Phone, otp: u2Otp.data.devOtp, name: 'Rohit Sharma' });
  const u2Socket = io(SERVER_URL, { reconnection: false });
  await new Promise(r => u2Socket.on('connect', r));
  u2Socket.emit('auth:register', { token: u2Verify.data.token, phone: user2Phone });
  await new Promise(r => setTimeout(r, 100));

  await new Promise((resolve) => {
    u2Socket.emit('room:join', { token: u2Verify.data.token, code: roomCode, phone: user2Phone }, resolve);
  });
  const u2VoteRes = await new Promise((resolve) => {
    u2Socket.emit('planning:vote', { vote: 'coming', comment: 'Hitman ready!' }, resolve);
  });

  const finalMembers = getDeduplicatedPlanningMembers(u2VoteRes.room.planning);
  const finalComing = finalMembers.filter(m => m.vote === 'coming').length;
  const finalMaybe = finalMembers.filter(m => m.vote === 'maybe').length;
  const finalTotal = finalMembers.length;

  console.log(`\n🧪 Multi-User Count Test:`);
  console.log(`   Total Unique Members: ${finalTotal} (Expected: 2)`);
  console.log(`   Coming (Rohit): ${finalComing} (Expected: 1)`);
  console.log(`   Maybe (Virat): ${finalMaybe} (Expected: 1)`);

  if (finalTotal !== 2 || finalComing !== 1 || finalMaybe !== 1) {
    console.error('❌ Multi-user count test failed!');
    process.exit(1);
  }

  phoneSocket.disconnect();
  laptopSocket.disconnect();
  u2Socket.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL CROSS-DEVICE RSVP DEDUPLICATION TESTS PASSED 100%');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
