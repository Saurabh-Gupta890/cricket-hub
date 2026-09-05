const io = require('socket.io-client');
const http = require('http');
const assert = require('assert');

const BASE_URL = 'http://localhost:3000';

function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(BASE_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function waitForEvent(socket, eventName, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);
    function handler(data) {
      clearTimeout(timer);
      socket.off(eventName, handler);
      resolve(data);
    }
    socket.on(eventName, handler);
  });
}

// Client fmtTime helper simulation
function fmtTime(val) {
  if (!val) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (typeof val === 'string' && (/^\d{1,2}:\d{2}(\s?[APap][Mm])?$/.test(val.trim()) || /^\d{1,2}:\d{2}:\d{2}/.test(val.trim()))) {
    return val.trim();
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function testChatTimestamp() {
  console.log('🧪 Testing Chat Message Timestamps and Invalid Date fix...');

  // Unit tests on fmtTime
  assert.notStrictEqual(fmtTime(undefined), 'Invalid Date');
  assert.notStrictEqual(fmtTime(null), 'Invalid Date');
  assert.notStrictEqual(fmtTime(''), 'Invalid Date');
  assert.strictEqual(fmtTime('09:03 PM'), '09:03 PM');
  assert.strictEqual(fmtTime('14:30'), '14:30');
  assert.notStrictEqual(fmtTime('2026-09-05T15:30:00.000Z'), 'Invalid Date');
  console.log('✅ Unit assertions for fmtTime passed (no Invalid Date possible)');

  const hostPhone = '+919999900555';
  const otpRes = await postJson('/api/auth/request-otp', { phone: hostPhone });
  const devOtp = otpRes.data.devOtp;

  const verifyRes = await postJson('/api/auth/verify-otp', { phone: hostPhone, otp: devOtp, name: 'ChatTimeHost' });
  const token = verifyRes.data.token;

  const socket = io(BASE_URL, { reconnection: false, forceNew: true });
  await new Promise(r => socket.on('connect', r));

  // 1. Create Room
  let roomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token, matchName: 'Chat Time Test Room' }, (res) => {
      roomCode = res.room.code;
      resolve();
    });
  });

  // 2. Setup match
  socket.emit('match:setup', {
    overs: 1,
    team1: { name: 'Alpha', players: ['A1', 'A2'] },
    team2: { name: 'Beta', players: ['B1', 'B2'] }
  });
  await new Promise(r => setTimeout(r, 100));

  // 3. Rematch trigger
  const pRematchChat = waitForEvent(socket, 'chat:message');
  socket.emit('match:rematch', { resetToSetup: false });
  const rematchMsg = await pRematchChat;
  console.log('Rematch message received:', rematchMsg);
  assert.ok(rematchMsg.timestamp, 'Rematch message must have timestamp');
  const formattedRematchTime = fmtTime(rematchMsg.timestamp || rematchMsg.time);
  assert.notStrictEqual(formattedRematchTime, 'Invalid Date');
  console.log('✅ Rematch message timestamp formatted cleanly:', formattedRematchTime);

  // 4. Send chat message
  const pUserChat = waitForEvent(socket, 'chat:message');
  socket.emit('chat:message', { text: 'Hello squad!' });
  const userMsg = await pUserChat;
  assert.ok(userMsg.timestamp);
  const formattedUserTime = fmtTime(userMsg.timestamp);
  assert.notStrictEqual(formattedUserTime, 'Invalid Date');
  console.log('✅ User message timestamp formatted cleanly:', formattedUserTime);

  socket.disconnect();
  console.log('🎉 ALL CHAT TIMESTAMP TESTS PASSED 100%!');
}

testChatTimestamp().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
