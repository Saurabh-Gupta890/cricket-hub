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

async function testWicketPriorityAndRunout() {
  console.log('🧪 Testing Wicket Priority & Run Out Striker/Non-Striker Dismissal...');

  const hostPhone = '+919999900888';
  const otpRes = await postJson('/api/auth/request-otp', { phone: hostPhone });
  const devOtp = otpRes.data.devOtp;

  const verifyRes = await postJson('/api/auth/verify-otp', { phone: hostPhone, otp: devOtp, name: 'Host Scorer' });
  const token = verifyRes.data.token;

  const socket = io(BASE_URL, { reconnection: false, forceNew: true });
  await new Promise(r => socket.on('connect', r));

  // Create room
  let roomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token, matchName: 'Wicket Test Room' }, (res) => {
      roomCode = res.room.code;
      resolve();
    });
  });

  // Setup match with 3 players in team 1
  socket.emit('match:setup', {
    overs: 5,
    team1: { name: 'Team Alpha', players: ['Player 1', 'Player 2', 'Player 3'] },
    team2: { name: 'Team Beta', players: ['Bowler 1', 'Bowler 2'] }
  });
  await new Promise(r => setTimeout(r, 100));

  // Toss
  socket.emit('match:startToss');
  await new Promise(r => setTimeout(r, 100));

  socket.emit('match:toss', { winner: 'team1', decision: 'bat' });
  await new Promise(r => setTimeout(r, 100));

  // Set opening batsmen & bowler
  await new Promise((resolve) => {
    socket.emit('score:setBatsmen', {
      inningsIdx: 0,
      striker: 'Player 1',
      nonStriker: 'Player 2',
      token
    }, resolve);
  });
  await new Promise((resolve) => {
    socket.emit('score:setBowler', {
      inningsIdx: 0,
      bowlerName: 'Bowler 1',
      token
    }, resolve);
  });

  // 1. Test Wicket Priority (e.g. Host clicked run=4 and wicket=true, Bowled)
  // Even if runs=4 was passed, server should enforce safeRuns = 0 because it's a Bowled dismissal!
  const p1 = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 4,
    wicket: true,
    dismissalType: 'Bowled',
    dismissal: 'b Bowler 1',
    dismissedSlot: 'striker',
    token
  });
  const state1 = await p1;
  const inn1 = state1.match.innings[0];
  assert.strictEqual(inn1.runs, 0, 'Runs should be 0 because Wicket has priority on normal dismissal');
  assert.strictEqual(inn1.wickets, 1, 'Wickets should be 1');
  assert.strictEqual(inn1.batsmen[0].out, true, 'Player 1 (Striker) should be out');
  assert.strictEqual(inn1.batsmen[0].runs, 0, 'Player 1 should have 0 runs');
  assert.strictEqual(inn1.currentBatsmen[0], null, 'Striker slot should be null awaiting new batsman');
  assert.strictEqual(inn1.currentBatsmen[1], 1, 'Non-striker (Player 2) should still be at index 1');
  assert.strictEqual(inn1.bowlers[0].wickets, 1, 'Bowler should get credit for Bowled');
  console.log('✅ PASS: Normal Wicket priority enforced (Runs: 0, Wickets: 1, Bowler credited)');

  // Bring in Player 3 as next batsman
  await new Promise((resolve) => {
    socket.emit('score:nextBatsman', {
      inningsIdx: 0,
      batsmanName: 'Player 3',
      token
    }, resolve);
  });

  // 2. Test Run Out of Non-Striker with 1 completed run!
  // Player 3 is Striker, Player 2 is Non-Striker.
  // Delivery: 1 run completed, Player 2 (Non-Striker) gets Run Out!
  const p2 = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 1,
    wicket: true,
    dismissalType: 'Run Out',
    dismissal: 'run out (Direct Hit)',
    dismissedSlot: 'non_striker',
    token
  });
  const state2 = await p2;
  const inn2 = state2.match.innings[0];
  assert.strictEqual(inn2.runs, 1, 'Team runs should be 1 (completed run before runout)');
  assert.strictEqual(inn2.wickets, 2, 'Total wickets should be 2');
  // Player 2 (Non-Striker) should be dismissed
  assert.strictEqual(inn2.batsmen[1].name, 'Player 2');
  assert.strictEqual(inn2.batsmen[1].out, true, 'Player 2 (Non-Striker) must be marked OUT');
  // Player 3 (Striker) should be NOT out and scored 1 run
  assert.strictEqual(inn2.batsmen[2].name, 'Player 3');
  assert.strictEqual(inn2.batsmen[2].out, false, 'Player 3 (Striker) must remain NOT OUT');
  assert.strictEqual(inn2.batsmen[2].runs, 1, 'Player 3 scored 1 run');
  // Bowler should NOT get credited with runout wicket
  assert.strictEqual(inn2.bowlers[0].wickets, 1, 'Bowler should NOT get wicket credit for Run Out');
  assert.strictEqual(inn2.awaitingNewBatsman, true, 'Should be awaiting next batsman');
  console.log('✅ PASS: Run Out of Non-Striker verified (Non-striker OUT, Striker NOT OUT, completed runs counted)');

  socket.disconnect();
  console.log('\n🎉 ALL WICKET PRIORITY & RUNOUT DISMISSAL TESTS PASSED 100%!');
}

testWicketPriorityAndRunout().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
