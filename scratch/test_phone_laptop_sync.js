/**
 * Test: Phone and Laptop Multi-device Sync with Same Phone Number
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
  console.log('📱💻 TESTING PHONE & LAPTOP REAL-TIME SYNC (SAME PHONE NUMBER)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const phone = '9876540001';

  // 1. Auth on Phone
  const otpResPhone = await makeRequest('POST', '/api/auth/request-otp', { phone, name: 'Saurabh Gupta' });
  const authPhone = await makeRequest('POST', '/api/auth/verify-otp', {
    phone,
    otp: otpResPhone.data.devOtp,
    name: 'Saurabh Gupta'
  });
  const tokenPhone = authPhone.data.token;
  console.log(`✅ Phone Logged In: Saurabh Gupta (+${phone})`);

  // 2. Auth on Laptop (Same user/phone)
  const otpResLaptop = await makeRequest('POST', '/api/auth/request-otp', { phone, name: 'Saurabh Gupta' });
  const authLaptop = await makeRequest('POST', '/api/auth/verify-otp', {
    phone,
    otp: otpResLaptop.data.devOtp,
    name: 'Saurabh Gupta'
  });
  const tokenLaptop = authLaptop.data.token;
  console.log(`✅ Laptop Logged In (Same Account): Saurabh Gupta (+${phone})`);

  // 3. Connect Sockets for Phone and Laptop
  const socketPhone = io(BASE_URL, { reconnection: false, transports: ['websocket'] });
  const socketLaptop = io(BASE_URL, { reconnection: false, transports: ['websocket'] });

  await new Promise(r => socketPhone.on('connect', r));
  await new Promise(r => socketLaptop.on('connect', r));

  socketPhone.emit('user:register', { token: tokenPhone, phone });
  socketLaptop.emit('user:register', { token: tokenLaptop, phone });
  await new Promise(r => setTimeout(r, 200));

  // 4. Create Room on Phone
  let roomCode = null;
  await new Promise((resolve, reject) => {
    socketPhone.emit('room:create', {
      token: tokenPhone,
      matchName: 'Sunday League Match',
      overs: 10
    }, (res) => {
      if (!res.success) return reject(new Error(res.error));
      roomCode = res.room.code;
      console.log(`✅ Phone created room: ${roomCode}`);
      resolve();
    });
  });

  // 5. Laptop joins the same room
  await new Promise((resolve, reject) => {
    socketLaptop.emit('room:join', { token: tokenLaptop, code: roomCode }, (res) => {
      if (!res.success) return reject(new Error(res.error));
      console.log(`✅ Laptop joined room: ${roomCode}`);
      resolve();
    });
  });

  // 6. Test 1: Phone votes "coming" -> Laptop should receive real-time update
  console.log('\n🧪 [TEST 1] Phone votes "coming"...');
  const laptopUpdate1Promise = new Promise((resolve) => {
    socketLaptop.once('planning:update', (room) => resolve(room));
  });

  await new Promise((resolve) => {
    socketPhone.emit('planning:vote', { vote: 'coming', comment: 'On my way!' }, resolve);
  });

  const roomStateOnLaptop1 = await laptopUpdate1Promise;
  const members1 = Object.values(roomStateOnLaptop1.planning.members);
  const myMember1 = members1.find(m => m.phone.includes(phone.slice(-10)));

  console.log(`   📊 Total Members: ${members1.length}`);
  console.log(`   🗳️ Vote on Laptop: "${myMember1?.vote}", Comment: "${myMember1?.comment}"`);

  if (members1.length !== 1) {
    throw new Error(`Expected exactly 1 member for same user, got ${members1.length}`);
  }
  if (myMember1?.vote !== 'coming') {
    throw new Error(`Expected vote 'coming', got ${myMember1?.vote}`);
  }
  console.log('✅ Phone vote "coming" synced to Laptop 100%!');

  // 7. Test 2: Laptop changes vote to "not_coming" -> Phone should receive real-time update
  console.log('\n🧪 [TEST 2] Laptop changes vote to "not_coming"...');
  const phoneUpdate2Promise = new Promise((resolve) => {
    socketPhone.once('planning:update', (room) => resolve(room));
  });

  await new Promise((resolve) => {
    socketLaptop.emit('planning:vote', { vote: 'not_coming', comment: 'Injured ankle' }, resolve);
  });

  const roomStateOnPhone2 = await phoneUpdate2Promise;
  const members2 = Object.values(roomStateOnPhone2.planning.members);
  const myMember2 = members2.find(m => m.phone.includes(phone.slice(-10)));

  console.log(`   📊 Total Members: ${members2.length}`);
  console.log(`   🗳️ Vote on Phone: "${myMember2?.vote}", Comment: "${myMember2?.comment}"`);

  if (members2.length !== 1) {
    throw new Error(`Expected exactly 1 member for same user, got ${members2.length}`);
  }
  if (myMember2?.vote !== 'not_coming') {
    throw new Error(`Expected vote 'not_coming', got ${myMember2?.vote}`);
  }
  console.log('✅ Laptop vote "not_coming" synced to Phone 100%!');

  // 8. Test 3: Laptop changes vote to "maybe" -> Phone receives update
  console.log('\n🧪 [TEST 3] Laptop changes vote to "maybe"...');
  const phoneUpdate3Promise = new Promise((resolve) => {
    socketPhone.once('planning:update', (room) => resolve(room));
  });

  await new Promise((resolve) => {
    socketLaptop.emit('planning:vote', { vote: 'maybe', comment: 'Will let you know by 4 PM' }, resolve);
  });

  const roomStateOnPhone3 = await phoneUpdate3Promise;
  const members3 = Object.values(roomStateOnPhone3.planning.members);
  const myMember3 = members3.find(m => m.phone.includes(phone.slice(-10)));

  console.log(`   📊 Total Members: ${members3.length}`);
  console.log(`   🗳️ Vote on Phone: "${myMember3?.vote}", Comment: "${myMember3?.comment}"`);

  if (members3.length !== 1) {
    throw new Error(`Expected exactly 1 member for same user, got ${members3.length}`);
  }
  if (myMember3?.vote !== 'maybe') {
    throw new Error(`Expected vote 'maybe', got ${myMember3?.vote}`);
  }
  console.log('✅ Laptop vote "maybe" synced to Phone 100%!');

  socketPhone.disconnect();
  socketLaptop.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL PHONE & LAPTOP REAL-TIME SYNC TESTS PASSED 100%');
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

runTest().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
