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

async function testTiedMatchResult() {
  console.log('🧪 Testing Tied Match (0-0 score) Result Calculation...');

  const hostPhone = '+919999900333';
  const otpRes = await postJson('/api/auth/request-otp', { phone: hostPhone });
  const devOtp = otpRes.data.devOtp;

  const verifyRes = await postJson('/api/auth/verify-otp', { phone: hostPhone, otp: devOtp, name: 'TiedMatchHost' });
  const token = verifyRes.data.token;

  const socket = io(BASE_URL, { reconnection: false, forceNew: true });
  await new Promise(r => socket.on('connect', r));

  // 1. Create Room
  let roomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token, matchName: 'Tied Match Test' }, (res) => {
      roomCode = res.room.code;
      resolve();
    });
  });

  // 2. Setup match
  socket.emit('match:setup', {
    overs: 5,
    team1: { name: 'Team 1', players: ['T1 Player'] },
    team2: { name: 'Team 2', players: ['T2 Player'] }
  });
  await new Promise(r => setTimeout(r, 100));

  // 3. Toss: Team 2 bats first
  socket.emit('match:startToss');
  await new Promise(r => setTimeout(r, 100));
  socket.emit('match:toss', { winner: 'team2', choice: 'bat' });
  await new Promise(r => setTimeout(r, 100));

  // 4. Innings 1: Team 2 single batter (T2 Player) & bowler (T1 Player)
  await new Promise((resolve) => {
    socket.emit('score:setBatsmen', {
      inningsIdx: 0,
      striker: 'T2 Player',
      nonStriker: '',
      isSingleBatter: true,
      token
    }, resolve);
  });

  await new Promise((resolve) => {
    socket.emit('score:setBowler', {
      inningsIdx: 0,
      bowlerName: 'T1 Player',
      token
    }, resolve);
  });

  // Ball 1: T2 Player gets Bowled (0 runs, 1 wicket -> All out -> switch to 2nd innings)
  const pInn1 = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    extras: {},
    wicket: true,
    dismissalType: 'Bowled',
    token
  });
  const st1 = await pInn1;
  console.log('1st innings score:', `${st1.match.innings[0].runs}/${st1.match.innings[0].wickets}`);
  assert.strictEqual(st1.match.status, 'innings2');

  // 5. Innings 2: Team 1 single batter (T1 Player) & bowler (T2 Player)
  await new Promise((resolve) => {
    socket.emit('score:setBatsmen', {
      inningsIdx: 1,
      striker: 'T1 Player',
      nonStriker: '',
      isSingleBatter: true,
      token
    }, resolve);
  });

  await new Promise((resolve) => {
    socket.emit('score:setBowler', {
      inningsIdx: 1,
      bowlerName: 'T2 Player',
      token
    }, resolve);
  });

  // Ball 1: T1 Player gets Bowled (0 runs, 1 wicket -> All out -> match completed!)
  const pInn2 = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 1,
    runs: 0,
    extras: {},
    wicket: true,
    dismissalType: 'Bowled',
    token
  });
  const st2 = await pInn2;
  console.log('2nd innings score:', `${st2.match.innings[1].runs}/${st2.match.innings[1].wickets}`);
  console.log('Final Match Status:', st2.match.status);
  console.log('Calculated Result:', st2.match.result);

  assert.strictEqual(st2.match.status, 'completed');
  assert.strictEqual(st2.match.result.winner, 'tie', 'Result winner must be "tie"');
  assert.ok(st2.match.result.summary.toLowerCase().includes('tied'), 'Summary must contain "Tied"');
  assert.strictEqual(st2.match.result.summary, 'Match Tied (0 - 0)');

  socket.disconnect();
  console.log('🎉 TIED MATCH RESULT ASSERTIONS PASSED 100%!');
}

testTiedMatchResult().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
