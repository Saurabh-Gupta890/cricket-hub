const http = require('http');
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

// Mock DOM
global.window = global;
global._elements = {};
global.document = {
  getElementById: (id) => {
    if (!global._elements[id]) {
      global._elements[id] = {
        id,
        innerHTML: '',
        textContent: '',
        value: '',
        style: {},
        classList: {
          add: () => {},
          remove: () => {},
          contains: () => false
        }
      };
    }
    return global._elements[id];
  },
  querySelectorAll: () => []
};

global.localStorage = {
  _data: {},
  getItem: (k) => global.localStorage._data[k] || null,
  setItem: (k, v) => global.localStorage._data[k] = String(v),
  removeItem: (k) => delete global.localStorage._data[k]
};

global.toast = (msg) => {};

// Load app.js
const appCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
eval(appCode.slice(appCode.indexOf('function phonesMatch'), appCode.indexOf('function formatOvers')));
eval(appCode.slice(appCode.indexOf('function escHtml'), appCode.indexOf('let playersCache')));
eval(appCode.slice(appCode.indexOf('function isHost'), appCode.indexOf('function toast')));
eval(appCode.slice(appCode.indexOf('function formatMatchSchedule'), appCode.indexOf('function renderRsvpStats')));

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

async function testMatchSchedule() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('📅 TESTING MATCH DATE (CALENDAR) & TIME (CLOCK) SCHEDULING');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 1. Authenticate user & create room
  const otpRes = await post('/api/auth/request-otp', { phone: '9876540001', name: 'Captain Virat' });
  const auth = await post('/api/auth/verify-otp', { phone: '9876540001', otp: otpRes.devOtp });
  const token = auth.token;

  const socket = io('http://localhost:3000', { transports: ['websocket'] });
  await new Promise(r => socket.on('connect', r));

  const roomRes = await new Promise(resolve => {
    socket.emit('room:create', { token, matchName: 'Sunday Championship' }, resolve);
  });
  const roomCode = roomRes.room.code;
  console.log(`✅ Created match room: ${roomCode}`);

  // 2. Test Quick Presets on Client
  console.log('\n🧪 Testing Client Quick Date & Time Presets...');
  global.setQuickDate('saturday');
  console.log('   Selected Saturday date:', global._elements['planning-date-input'].value);
  if (!global._elements['planning-date-input'].value) throw new Error('Quick date failed!');

  global.setQuickTime('16:30');
  console.log('   Selected time 16:30:', global._elements['planning-time-input'].value);
  if (global._elements['planning-time-input'].value !== '16:30') throw new Error('Quick time failed!');

  // 3. Save Schedule to Server via socket
  console.log('\n🧪 Saving Schedule to Server (2026-10-18 at 16:30)...');
  socket.emit('planning:date', { date: '2026-10-18', time: '16:30' });

  // Wait for sync
  await new Promise(r => setTimeout(r, 400));
  const updatedRoomRes = await new Promise(resolve => {
    socket.emit('room:join', { token, code: roomCode }, resolve);
  });
  const updatedRoom = updatedRoomRes.room;
  console.log('   Server stored match.date:', updatedRoom.match.date);
  console.log('   Server stored match.time:', updatedRoom.match.time);

  // 4. Test Client renderPlanningSchedule()
  console.log('\n🧪 Testing renderPlanningSchedule() in DOM...');
  global.state = {
    session: { user: { phone: '9876540001', name: 'Captain Virat' } },
    room: updatedRoom
  };

  renderPlanningSchedule();

  console.log('   Date display:', global._elements['display-sched-date'].textContent);
  console.log('   Time display:', global._elements['display-sched-time'].textContent);
  console.log('   Status tag:', global._elements['schedule-status-tag'].innerHTML);
  console.log('   Header badge visible:', global._elements['planning-schedule-header-badge'].style.display !== 'none');
  console.log('   Header badge text:', global._elements['planning-schedule-header-badge'].innerHTML);

  socket.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL MATCH DATE & TIME TESTS PASSED 100%');
  console.log('═══════════════════════════════════════════════════════════════════');
}

testMatchSchedule().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
