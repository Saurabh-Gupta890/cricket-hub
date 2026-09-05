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

async function testAllOutDirectSummary() {
  console.log('🧪 Starting 2nd Innings All-Out Direct Completion test...');

  const hostPhone = '+919999900777';
  const otpRes = await postJson('/api/auth/request-otp', { phone: hostPhone });
  const devOtp = otpRes.data.devOtp;

  const verifyRes = await postJson('/api/auth/verify-otp', { phone: hostPhone, otp: devOtp, name: 'HostDirectSummary' });
  const token = verifyRes.data.token;

  const socket = io(BASE_URL, { reconnection: false, forceNew: true });
  await new Promise(r => socket.on('connect', r));

  // 1. Create Room
  let roomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token, matchName: 'Direct Summary Test Room' }, (res) => {
      roomCode = res.room.code;
      resolve();
    });
  });

  // 2. Setup Match with 2 players per team
  socket.emit('match:setup', {
    overs: 5,
    team1: { name: 'Team Alpha', players: ['Alpha 1', 'Alpha 2'] },
    team2: { name: 'Team Beta', players: ['Beta 1', 'Beta 2'] }
  });
  await new Promise(r => setTimeout(r, 100));

  // 3. Toss
  socket.emit('match:startToss');
  await new Promise(r => setTimeout(r, 100));

  socket.emit('match:toss', { winner: 'team1', decision: 'bat' });
  await new Promise(r => setTimeout(r, 100));

  // 4. Innings 1: Set Batsmen & Bowler
  await new Promise((resolve) => {
    socket.emit('score:setBatsmen', {
      inningsIdx: 0,
      striker: 'Alpha 1',
      nonStriker: 'Alpha 2',
      token
    }, resolve);
  });

  await new Promise((resolve) => {
    socket.emit('score:setBowler', {
      inningsIdx: 0,
      bowlerName: 'Beta 1',
      token
    }, resolve);
  });

  // 1st ball: Alpha 1 Bowled (Wicket 1)
  const p1 = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    extras: {},
    wicket: true,
    dismissalType: 'Bowled',
    token
  });
  const upd1 = await p1;
  assert.strictEqual(upd1.match.innings[0].awaitingNewBatsman, true, 'Should await new batsman or single batter after 1st wicket');

  // Alpha 2 continues single mode
  await new Promise((resolve) => {
    socket.emit('score:nextBatsman', {
      inningsIdx: 0,
      isSingleBatter: true,
      token
    }, resolve);
  });

  // 2nd ball: Alpha 2 Bowled (Wicket 2 -> ALL OUT INNINGS 1)
  const pInn1AllOut = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    extras: {},
    wicket: true,
    dismissalType: 'Bowled',
    token
  });
  const updInn1AllOut = await pInn1AllOut;
  console.log('1st innings all out status:', updInn1AllOut.match.status);
  assert.strictEqual(updInn1AllOut.match.status, 'innings2', '1st innings all out should transition directly to innings2');
  assert.strictEqual(updInn1AllOut.match.innings[0].completed, true, 'Innings 0 should be completed');
  console.log('✅ 1st innings all out cleanly transitioned to 2nd innings');

  // 5. Innings 2: Set Batsmen & Bowler
  await new Promise((resolve) => {
    socket.emit('score:setBatsmen', {
      inningsIdx: 1,
      striker: 'Beta 1',
      nonStriker: 'Beta 2',
      token
    }, resolve);
  });

  await new Promise((resolve) => {
    socket.emit('score:setBowler', {
      inningsIdx: 1,
      bowlerName: 'Alpha 1',
      token
    }, resolve);
  });

  // 2nd innings ball 1: Beta 1 Bowled (Wicket 1)
  const p2 = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 1,
    runs: 0,
    extras: {},
    wicket: true,
    dismissalType: 'Bowled',
    token
  });
  const upd2 = await p2;
  assert.strictEqual(upd2.match.innings[1].awaitingNewBatsman, true, 'Should await next batsman or single mode');

  // Beta 2 continues single mode
  await new Promise((resolve) => {
    socket.emit('score:nextBatsman', {
      inningsIdx: 1,
      isSingleBatter: true,
      token
    }, resolve);
  });

  // 2nd innings ball 2: Beta 2 Bowled (Wicket 2 -> ALL OUT INNINGS 2 / MATCH COMPLETED!)
  const pInn2AllOut = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 1,
    runs: 0,
    extras: {},
    wicket: true,
    dismissalType: 'Bowled',
    token
  });
  const updInn2AllOut = await pInn2AllOut;

  console.log('2nd innings all out status:', updInn2AllOut.match.status);
  console.log('2nd innings completed flag:', updInn2AllOut.match.innings[1].completed);
  console.log('2nd innings awaitingNewBatsman:', updInn2AllOut.match.innings[1].awaitingNewBatsman);
  console.log('Result summary:', updInn2AllOut.match.result?.summary);

  assert.strictEqual(updInn2AllOut.match.status, 'completed', '2nd innings all out must directly complete the match');
  assert.strictEqual(updInn2AllOut.match.innings[1].completed, true, '2nd innings must be marked completed');
  assert.strictEqual(updInn2AllOut.match.innings[1].awaitingNewBatsman, false, 'awaitingNewBatsman must be false');
  assert.ok(updInn2AllOut.match.result?.summary, 'Result summary must be calculated');

  console.log('🎉 2nd innings all out DIRECTLY transitioned match to completed status without any modal prompt!');

  socket.disconnect();
  console.log('✅ All direct summary all-out assertions passed successfully!');
}

testAllOutDirectSummary().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
