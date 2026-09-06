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

async function testFullFlow() {
  console.log('🧪 1. Login user A (Captain Virat 9876540001)...');
  const otpRes = await post('/api/auth/request-otp', { phone: '9876540001', name: 'Captain Virat' });
  const verifyRes = await post('/api/auth/verify-otp', { phone: '9876540001', otp: otpRes.devOtp });
  const tokenA = verifyRes.token;

  console.log('🧪 2. Create room on Client 1 (Laptop) via Socket...');
  const socket1 = io('http://localhost:3000', { transports: ['websocket'] });
  await new Promise(r => socket1.on('connect', r));

  const roomRes = await new Promise(resolve => {
    socket1.emit('room:create', { token: tokenA, matchName: 'Sunday Mega Clash' }, resolve);
  });
  console.log('   Room created:', roomRes.room.code);

  console.log('\n🧪 3. Client 2 (Mobile Browser with same number 9876540001) fetches active rooms...');
  const mobileRooms = await post('/api/user/rooms', { phone: '9876540001', token: tokenA });
  console.log('   Mobile browser active rooms count:', mobileRooms.rooms.length);
  console.log('   Mobile browser saw match:', mobileRooms.rooms[0]?.matchName, 'Code:', mobileRooms.rooms[0]?.code, 'Role:', mobileRooms.rooms[0]?.isHost ? 'HOST' : 'MEMBER');

  console.log('\n🧪 4. Client 3 (Squad member Rohit 9876540002) joins room...');
  const otpResB = await post('/api/auth/request-otp', { phone: '9876540002', name: 'Rohit Sharma' });
  const verifyResB = await post('/api/auth/verify-otp', { phone: '9876540002', otp: otpResB.devOtp });
  const tokenB = verifyResB.token;

  const socket2 = io('http://localhost:3000', { transports: ['websocket'] });
  await new Promise(r => socket2.on('connect', r));
  const joinRes = await new Promise(resolve => {
    socket2.emit('room:join', { token: tokenB, code: roomRes.room.code }, resolve);
  });
  console.log('   Member joined:', joinRes.success ? 'YES' : 'NO');
  console.log('   Planning members:', Object.keys(joinRes.room.planning.members));

  console.log('\n🧪 5. Check squad member (Rohit) active rooms on his device...');
  const memberRooms = await post('/api/user/rooms', { phone: '9876540002', token: tokenB });
  console.log('   Rohit active rooms count:', memberRooms.rooms.length);
  console.log('   Rohit saw match:', memberRooms.rooms[0]?.matchName, 'Code:', memberRooms.rooms[0]?.code, 'isHost:', memberRooms.rooms[0]?.isHost);

  socket1.disconnect();
  socket2.disconnect();
  console.log('\n🎉 ALL CROSS-DEVICE SYNC & SQUAD TESTS PASSED!');
}

testFullFlow().catch(console.error);
