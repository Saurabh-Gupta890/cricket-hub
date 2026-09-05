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

async function runTest() {
  console.log('🚀 Starting Bowler Wickets Attribution Verification...');

  const hostPhone = `+919999900${Math.floor(100 + Math.random() * 900)}`;
  const otpRes = await postJson('/api/auth/request-otp', { phone: hostPhone, name: 'Captain Rohit' });
  const devOtp = otpRes.data.devOtp;

  const verifyRes = await postJson('/api/auth/verify-otp', { phone: hostPhone, otp: devOtp, name: 'Captain Rohit' });
  const token = verifyRes.data.token;
  assert(token, 'Host token should exist');

  const socket = io(BASE_URL, { reconnection: false, forceNew: true });
  await new Promise(r => socket.on('connect', r));
  console.log('✅ Host connected to server');

  // 1. Create Room
  let roomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token, matchName: 'Bowler Wicket Test Room' }, (res) => {
      roomCode = res.room.code;
      resolve();
    });
  });
  console.log('✅ Room created:', roomCode);

  // 2. Setup Match
  socket.emit('match:setup', {
    overs: 5,
    team1: { name: 'India', players: ['Rohit', 'Gill', 'Kohli', 'Surya', 'Pant', 'Hardik', 'Jadeja'] },
    team2: { name: 'Australia', players: ['Cummins', 'Starc', 'Hazlewood', 'Zampa', 'Head', 'Warner', 'Carey'] }
  });
  await new Promise(r => setTimeout(r, 100));

  // 3. Toss
  socket.emit('match:startToss');
  await new Promise(r => setTimeout(r, 100));
  socket.emit('match:toss', { winner: 'team1', decision: 'bat' });
  await new Promise(r => setTimeout(r, 100));

  // 4. Set Batsmen & Bowler
  await new Promise((resolve) => {
    socket.emit('score:setBatsmen', {
      inningsIdx: 0,
      striker: 'Rohit',
      nonStriker: 'Gill',
      token
    }, resolve);
  });

  await new Promise((resolve) => {
    socket.emit('score:setBowler', {
      inningsIdx: 0,
      bowlerName: 'Cummins',
      token
    }, resolve);
  });
  console.log('✅ Batsmen & Bowler set (Striker: Rohit, NonStriker: Gill, Bowler: Cummins)');

  // ── TEST 1: Bowled dismissal ──────────────────────────
  console.log('\n🧪 Testing 1: Bowled dismissal...');
  const stateAfterBowledPromise = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    wicket: true,
    dismissal: null,
    dismissalType: 'Bowled',
    token
  });
  const stateAfterBowled = await stateAfterBowledPromise;

  const inn1 = stateAfterBowled.match.innings[0];
  const cummins1 = inn1.bowlers.find(b => b.name === 'Cummins');
  const rohit = inn1.batsmen.find(b => b.name === 'Rohit');

  assert.strictEqual(inn1.wickets, 1, 'Innings wickets should be 1');
  assert.strictEqual(cummins1.wickets, 1, 'Cummins should be credited with 1 wicket for Bowled');
  assert.strictEqual(rohit.dismissal, 'b Cummins', 'Rohit dismissal note should be "b Cummins"');
  console.log('✅ Test 1 Passed: Bowled credited to Cummins (1 wicket, dismissal: "b Cummins")');

  // Set next batter: Kohli
  await new Promise(resolve => {
    socket.emit('score:nextBatsman', { inningsIdx: 0, batsmanName: 'Kohli', token }, resolve);
  });

  // ── TEST 2: Caught dismissal (with custom fielder note) ──
  console.log('\n🧪 Testing 2: Caught dismissal (c Warner)...');
  const stateAfterCaughtPromise = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    wicket: true,
    dismissal: 'c Warner',
    dismissalType: 'Caught',
    token
  });
  const stateAfterCaught = await stateAfterCaughtPromise;

  const inn2 = stateAfterCaught.match.innings[0];
  const cummins2 = inn2.bowlers.find(b => b.name === 'Cummins');
  const kohli = inn2.batsmen.find(b => b.name === 'Kohli');

  assert.strictEqual(inn2.wickets, 2, 'Innings wickets should be 2');
  assert.strictEqual(cummins2.wickets, 2, 'Cummins should have 2 wickets after Caught');
  assert.strictEqual(kohli.dismissal, 'c Warner b Cummins', 'Kohli dismissal note should be "c Warner b Cummins"');
  console.log('✅ Test 2 Passed: Caught credited to Cummins (2 wickets, dismissal: "c Warner b Cummins")');

  // Set next batter: Surya
  await new Promise(resolve => {
    socket.emit('score:nextBatsman', { inningsIdx: 0, batsmanName: 'Surya', token }, resolve);
  });

  // ── TEST 3: Stumped dismissal ────────────────────────
  console.log('\n🧪 Testing 3: Stumped dismissal (st Carey)...');
  const stateAfterStumpedPromise = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    wicket: true,
    dismissal: 'st Carey',
    dismissalType: 'Stumped',
    token
  });
  const stateAfterStumped = await stateAfterStumpedPromise;

  const inn3 = stateAfterStumped.match.innings[0];
  const cummins3 = inn3.bowlers.find(b => b.name === 'Cummins');
  const surya = inn3.batsmen.find(b => b.name === 'Surya');

  assert.strictEqual(inn3.wickets, 3, 'Innings wickets should be 3');
  assert.strictEqual(cummins3.wickets, 3, 'Cummins should have 3 wickets after Stumped');
  assert.strictEqual(surya.dismissal, 'st Carey b Cummins', 'Surya dismissal note should be "st Carey b Cummins"');
  console.log('✅ Test 3 Passed: Stumped credited to Cummins (3 wickets, dismissal: "st Carey b Cummins")');

  // Set next batter: Pant
  await new Promise(resolve => {
    socket.emit('score:nextBatsman', { inningsIdx: 0, batsmanName: 'Pant', token }, resolve);
  });

  // ── TEST 4: Run Out dismissal (must NOT credit bowler) ──
  console.log('\n🧪 Testing 4: Run Out dismissal (Striker Run Out with 1 completed run)...');
  const stateAfterRunOutPromise = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 1,
    wicket: true,
    dismissal: 'Direct hit Head',
    dismissalType: 'Run Out',
    dismissedSlot: 'striker',
    token
  });
  const stateAfterRunOut = await stateAfterRunOutPromise;

  const inn4 = stateAfterRunOut.match.innings[0];
  const cummins4 = inn4.bowlers.find(b => b.name === 'Cummins');
  const pant = inn4.batsmen.find(b => b.name === 'Pant');

  assert.strictEqual(inn4.wickets, 4, 'Innings wickets should be 4');
  assert.strictEqual(cummins4.wickets, 3, 'Cummins must STILL have 3 wickets (Run Out not credited to bowler)');
  assert.strictEqual(pant.dismissal, 'Direct hit Head', 'Pant dismissal note should be "Direct hit Head"');
  console.log('✅ Test 4 Passed: Run Out NOT credited to Cummins (cummins wickets remain 3)');

  // Set next batter: Hardik
  await new Promise(resolve => {
    socket.emit('score:nextBatsman', { inningsIdx: 0, batsmanName: 'Hardik', token }, resolve);
  });

  // ── TEST 5: LBW dismissal ────────────────────────────
  console.log('\n🧪 Testing 5: LBW dismissal...');
  const stateAfterLBWPromise = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    wicket: true,
    dismissalType: 'LBW',
    token
  });
  const stateAfterLBW = await stateAfterLBWPromise;

  const inn5 = stateAfterLBW.match.innings[0];
  const cummins5 = inn5.bowlers.find(b => b.name === 'Cummins');
  const gill = inn5.batsmen.find(b => b.name === 'Gill');

  assert.strictEqual(inn5.wickets, 5, 'Innings wickets should be 5');
  assert.strictEqual(cummins5.wickets, 4, 'Cummins should now have 4 wickets (LBW credited)');
  assert.strictEqual(gill.dismissal, 'lbw b Cummins', 'Gill dismissal note should be "lbw b Cummins"');
  console.log('✅ Test 5 Passed: LBW credited to Cummins (4 wickets, dismissal: "lbw b Cummins")');

  socket.close();
  console.log('\n🎉 ALL BOWLER WICKET ATTRIBUTION TESTS PASSED 100%! 🏏');
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
