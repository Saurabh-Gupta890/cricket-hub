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

async function testPlayerSelectionFallback() {
  console.log('🧪 Testing Player Selection Fallback and Custom Name Entry...');

  const hostPhone = '+919999900666';
  const otpRes = await postJson('/api/auth/request-otp', { phone: hostPhone });
  const devOtp = otpRes.data.devOtp;

  const verifyRes = await postJson('/api/auth/verify-otp', { phone: hostPhone, otp: devOtp, name: 'CustomPlayerHost' });
  const token = verifyRes.data.token;

  const socket = io(BASE_URL, { reconnection: false, forceNew: true });
  await new Promise(r => socket.on('connect', r));

  // 1. Create Room (Starts with empty players in teams)
  let roomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token, matchName: 'No Predefined Squad Room' }, (res) => {
      roomCode = res.room.code;
      resolve();
    });
  });

  // 2. Setup match without providing player lists
  socket.emit('match:setup', {
    overs: 5,
    team1: { name: 'Custom XI 1', players: [] },
    team2: { name: 'Custom XI 2', players: [] }
  });
  await new Promise(r => setTimeout(r, 100));

  // 3. Toss
  socket.emit('match:startToss');
  await new Promise(r => setTimeout(r, 100));
  socket.emit('match:toss', { winner: 'team1', choice: 'bat' });
  await new Promise(r => setTimeout(r, 100));

  // 4. Set Batsmen with custom typed names
  const pSetBatsmen = waitForEvent(socket, 'state:update');
  socket.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Custom Striker A',
    nonStriker: 'Custom Non-Striker B',
    token
  });
  const st1 = await pSetBatsmen;
  assert.strictEqual(st1.match.innings[0].batsmen.length, 2);
  assert.strictEqual(st1.match.innings[0].batsmen[0].name, 'Custom Striker A');
  assert.strictEqual(st1.match.innings[0].batsmen[1].name, 'Custom Non-Striker B');
  assert.ok(st1.match.teams.team1.players.includes('Custom Striker A'), 'Custom striker should be synced into team roster');
  assert.ok(st1.match.teams.team1.players.includes('Custom Non-Striker B'), 'Custom non-striker should be synced into team roster');
  console.log('✅ Custom Batsmen successfully set and synced to team roster');

  // 5. Set Bowler with custom typed name
  const pSetBowler = waitForEvent(socket, 'state:update');
  socket.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Custom Bowler X',
    token
  });
  const st2 = await pSetBowler;
  assert.strictEqual(st2.match.innings[0].bowlers.length, 1);
  assert.strictEqual(st2.match.innings[0].bowlers[0].name, 'Custom Bowler X');
  assert.ok(st2.match.teams.team2.players.includes('Custom Bowler X'), 'Custom bowler should be synced to bowling team roster');
  console.log('✅ Custom Bowler successfully set and synced to bowling team roster');

  // 6. Score ball
  const pBall = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 4,
    extras: {},
    wicket: false,
    token
  });
  const st3 = await pBall;
  assert.strictEqual(st3.match.innings[0].runs, 4);
  assert.strictEqual(st3.match.innings[0].batsmen[0].runs, 4);
  console.log('✅ Scored ball successfully with custom players');

  socket.disconnect();
  console.log('🎉 ALL PLAYER SELECTION & CUSTOM INPUT TESTS PASSED 100%!');
}

testPlayerSelectionFallback().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
