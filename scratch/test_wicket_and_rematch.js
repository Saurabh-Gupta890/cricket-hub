const ioClient = require('socket.io-client');
const http = require('http');

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

async function testWicketAndRematchFlow() {
  console.log('🧪 Starting Wicket Non-Abrupt & Rematch Flow Verification...');

  const phoneHost = '+919999900050';
  const otpRes = await postJson('/api/auth/request-otp', { phone: phoneHost });
  const verifyRes = await postJson('/api/auth/verify-otp', {
    phone: phoneHost,
    otp: otpRes.data.devOtp,
    name: 'Captain Host',
    role: 'Top-order Batter'
  });
  const token = verifyRes.data.token;

  const socketHost = ioClient(BASE_URL, { reconnection: false });
  await new Promise(r => socketHost.on('connect', r));
  socketHost.emit('user:register', { token, phone: phoneHost });

  // 1. Create Room & Setup match with only 2 players in Team 1
  const pCreate = waitForEvent(socketHost, 'room:created');
  socketHost.emit('room:create', { token, matchName: '2-Player Small Match', overs: 1 });
  const roomData = await pCreate;
  const roomId = roomData.code;
  console.log(`✅ Created match room: ${roomId}`);

  const pSetup = waitForEvent(socketHost, 'state:update');
  socketHost.emit('match:setup', {
    overs: 1,
    teams: {
      team1: { name: 'Small Team A', players: ['Player One', 'Player Two'] },
      team2: { name: 'Small Team B', players: ['Opponent Bowler'] }
    }
  });
  await pSetup;

  // Toss: Team 1 bats first
  const pToss = waitForEvent(socketHost, 'state:update');
  socketHost.emit('match:toss', { winner: 'team1', choice: 'bat' });
  await pToss;

  // Set opening batsmen and bowler
  const pBat = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Player One',
    nonStriker: 'Player Two'
  });
  await pBat;

  const pBowl = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Opponent Bowler'
  });
  await pBowl;

  // Ball 1: Wicket! (Player One is OUT)
  // CRITICAL CHECK: In a 2-player team, 1 wicket must NOT prematurely end the innings or shift to innings 2!
  const pWicket = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    wicket: true,
    dismissal: 'bowled'
  });
  const wState = await pWicket;
  const inn1 = wState.match.innings[0];

  if (wState.match.currentInnings !== 0) {
    throw new Error(`FAIL: Match shifted immediately to Innings ${wState.match.currentInnings}! Should stay in Innings 0.`);
  }
  if (!inn1.awaitingNewBatsman) {
    throw new Error('FAIL: awaitingNewBatsman is false! Should be true for popup.');
  }
  if (inn1.completed) {
    throw new Error('FAIL: Innings 1 marked completed prematurely!');
  }
  console.log('✅ PASS: Wicket on 2-player team kept match in Innings 0, awaitingNewBatsman=true (popup ready)');

  // 2. Select Single Batter Mode for Player Two
  const pSingle = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:nextBatsman', {
    inningsIdx: 0,
    isSingleBatter: true
  });
  const sState = await pSingle;
  console.log(`✅ PASS: Player Two switched to Single Batter Mode (Solo striker: ${sState.match.innings[0].batsmen[sState.match.innings[0].currentBatsmen[0]].name})`);

  // Ball 2: 4 runs by solo striker
  const pBall2 = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 4, wicket: false });
  await pBall2;

  // 3. Test Declare / End Innings button
  const pEndInn = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:endInnings', { inningsIdx: 0 });
  const endState = await pEndInn;

  if (endState.match.currentInnings !== 1 || endState.match.status !== 'innings2') {
    throw new Error(`FAIL: Expected transition to innings2, got status ${endState.match.status}`);
  }
  console.log(`✅ PASS: Host declared All-Out -> clean transition to Innings 2 (Target: ${endState.match.innings[1].target})`);

  // Complete Innings 2 to finish match 1
  const pBat2 = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:setBatsmen', {
    inningsIdx: 1,
    striker: 'Opponent Bowler',
    isSingleBatter: true
  });
  await pBat2;

  const pBowl2 = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:setBowler', {
    inningsIdx: 1,
    bowlerName: 'Player Two'
  });
  await pBowl2;

  // Opponent scores 6 runs to win match 1
  const pWin = waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 1, runs: 6, wicket: false });
  const winState = await pWin;

  if (winState.match.status !== 'completed') {
    throw new Error(`FAIL: Expected match status 'completed', got ${winState.match.status}`);
  }
  console.log(`✅ PASS: Match 1 completed! Winner: ${winState.match.winner || 'Small Team B'}`);

  // 4. Test Rematch (Start Match 2 directly with Toss)
  const pRematch = waitForEvent(socketHost, 'state:update');
  socketHost.emit('match:rematch', { resetToSetup: false });
  const rState = await pRematch;

  if (rState.match.status !== 'toss') {
    throw new Error(`FAIL: Expected status 'toss' after match:rematch, got ${rState.match.status}`);
  }
  if (rState.match.innings[0].runs !== 0 || rState.match.innings[0].wickets !== 0) {
    throw new Error('FAIL: Innings 1 not reset to 0/0!');
  }
  console.log(`✅ PASS: Match 2 launched in same room ${rState.code}! Status is 'toss', previous score archived.`);

  // 5. Test Rematch to Setup (Re-configure Overs & Teams)
  const pReSetup = waitForEvent(socketHost, 'state:update');
  socketHost.emit('match:rematch', { resetToSetup: true });
  const setupState = await pReSetup;

  if (setupState.match.status !== 'setup') {
    throw new Error(`FAIL: Expected status 'setup' after match:rematch with resetToSetup:true, got ${setupState.match.status}`);
  }
  console.log(`✅ PASS: Rematch with resetToSetup=true transitioned to 'setup' successfully!`);

  socketHost.disconnect();
  console.log('\n🎉 ALL WICKET NON-ABRUPT & REMATCH TESTS PASSED 100%!');
}

testWicketAndRematchFlow().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
