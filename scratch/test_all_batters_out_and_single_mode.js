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

async function testAllBattersOutBehavior() {
  console.log('🧪 Testing All Batters Out, Single Mode Restrictions & End Innings Flow...');

  const phoneHost = '+919999900999';
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

  // 1. Create Room & Setup 2-player team
  const pCreate = waitForEvent(socketHost, 'room:created');
  socketHost.emit('room:create', { token, matchName: 'All Out Restriction Test' });
  const roomState = await pCreate;
  const roomCode = roomState.code;
  console.log(`✅ Room created: ${roomCode}`);

  socketHost.emit('match:setup', {
    teams: {
      team1: { name: 'Duo Batters', players: ['Batter A', 'Batter B'] },
      team2: { name: 'Duo Bowlers', players: ['Bowler X', 'Bowler Y'] }
    },
    overs: 5
  });
  await waitForEvent(socketHost, 'state:update');

  socketHost.emit('match:startToss');
  await waitForEvent(socketHost, 'state:update');
  socketHost.emit('match:toss', { winner: 'team1', choice: 'bat' });
  await waitForEvent(socketHost, 'state:update');

  // Set opening batsmen: Batter A (striker), Batter B (non-striker)
  socketHost.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Batter A',
    nonStriker: 'Batter B',
    isSingleBatter: false
  });
  await waitForEvent(socketHost, 'state:update');

  socketHost.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Bowler X'
  });
  await waitForEvent(socketHost, 'state:update');

  // Wicket 1: Batter A is OUT
  socketHost.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    extras: null,
    wicket: true,
    dismissal: 'caught'
  });
  const stateAfterW1 = await waitForEvent(socketHost, 'state:update');
  if (!stateAfterW1.match.innings[0].awaitingNewBatsman) {
    throw new Error('Expected awaitingNewBatsman to be true after Wicket 1');
  }
  console.log('✅ Wicket 1 fell: Batter A out. Modal awaiting new batsman is ready.');

  // Since Batter B is at non-striker (surviving), Single Batter mode should succeed
  const pStateSingle = waitForEvent(socketHost, 'state:update');
  const ackSingle1 = await new Promise(r => {
    socketHost.emit('score:nextBatsman', { inningsIdx: 0, isSingleBatter: true }, r);
  });
  const stateSingleMode = await pStateSingle;
  if (!ackSingle1 || !ackSingle1.success) {
    throw new Error('Expected Single Batter mode to succeed when surviving batter exists');
  }
  if (!stateSingleMode.match.innings[0].isSingleBatter) {
    throw new Error('Expected innings to be in isSingleBatter mode');
  }
  console.log('✅ PASS: Batter B is playing in Single Batter Mode.');

  // Score a ball with Batter B
  socketHost.emit('score:ball', {
    inningsIdx: 0,
    runs: 6,
    extras: null,
    wicket: false,
    dismissal: null
  });
  await waitForEvent(socketHost, 'state:update');

  // Wicket 2: Batter B is OUT (Now ALL batters on the team are OUT)
  socketHost.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    extras: null,
    wicket: true,
    dismissal: 'bowled'
  });
  const stateAfterW2 = await waitForEvent(socketHost, 'state:update');
  if (!stateAfterW2.match.innings[0].awaitingNewBatsman) {
    throw new Error('Expected awaitingNewBatsman to remain true so host gets the All Out popup!');
  }
  if (stateAfterW2.match.status !== 'innings1') {
    throw new Error(`Match should remain in innings1 waiting for host action, got: ${stateAfterW2.match.status}`);
  }
  console.log('✅ Wicket 2 fell: Batter B out (All batters out). Popup ready for host with All Out.');

  // Now both Batter A and Batter B are out. Single Batter mode MUST be rejected!
  const ackSingle2 = await new Promise(r => {
    socketHost.emit('score:nextBatsman', { inningsIdx: 0, isSingleBatter: true }, r);
  });
  if (ackSingle2 && ackSingle2.success) {
    throw new Error('Single Batter mode should NOT succeed when all batters are out!');
  }
  console.log(`✅ PASS: Single batter mode rejected when all batters are out (${ackSingle2?.error}).`);

  // Host clicks "End Innings (Next Team Bats)" -> clean transition to Innings 2
  const pState2 = waitForEvent(socketHost, 'state:update');
  const ackEndInnings = await new Promise(r => {
    socketHost.emit('score:endInnings', { inningsIdx: 0 }, r);
  });
  const stateInnings2 = await pState2;

  if (!ackEndInnings || !ackEndInnings.success) {
    throw new Error('Expected endInnings to succeed');
  }
  if (stateInnings2.match.status !== 'innings2') {
    throw new Error(`Expected status 'innings2', got '${stateInnings2.match.status}'`);
  }
  if (stateInnings2.match.innings[1].target !== 7) {
    throw new Error(`Expected target to be 7 (6 runs + 1), got ${stateInnings2.match.innings[1].target}`);
  }
  console.log('✅ PASS: Host clicked End Innings -> cleanly transitioned to Innings 2 with target: 7.');

  socketHost.disconnect();
  console.log('\n🎉 ALL ALL-OUT & SINGLE MODE FLOWS TESTED AND PASSED 100%!');
}

testAllBattersOutBehavior().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
