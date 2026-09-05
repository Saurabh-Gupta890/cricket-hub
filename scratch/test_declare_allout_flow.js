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

async function testDeclareAllOutFlow() {
  console.log('🧪 Testing Declare All Out / End Innings Flow...');

  const phoneHost = '+919876500111';
  const otpRes = await postJson('/api/auth/request-otp', { phone: phoneHost });
  const verifyRes = await postJson('/api/auth/verify-otp', {
    phone: phoneHost,
    otp: otpRes.data.devOtp,
    name: 'Captain Host',
    role: 'Top-order Batter'
  });
  const token = verifyRes.data.token;

  // Connect socket with raw digits phone format to verify phone matching works across formats
  const socketHost = ioClient(BASE_URL, { reconnection: false });
  await new Promise(r => socketHost.on('connect', r));
  socketHost.emit('user:register', { token, phone: '9876500111' });

  // 1. Create Room & Setup match
  console.log('Emitting room:create...');
  const pCreate = waitForEvent(socketHost, 'room:created');
  socketHost.emit('room:create', { token, matchName: 'AllOut Test League' });
  const roomState = await pCreate;
  const roomCode = roomState.code;
  console.log(`✅ Created match room: ${roomCode}`);

  console.log('Emitting match:setup...');
  const pSetup = waitForEvent(socketHost, 'state:update');
  socketHost.emit('match:setup', {
    teams: {
      team1: { name: 'Alpha XI', players: ['Alpha 1', 'Alpha 2'] },
      team2: { name: 'Beta XI', players: ['Beta 1', 'Beta 2'] }
    },
    overs: 5
  });
  await pSetup;
  console.log('✅ match:setup done');

  // Toss
  console.log('Emitting match:startToss...');
  const pToss1 = waitForEvent(socketHost, 'state:update');
  socketHost.emit('match:startToss');
  await pToss1;
  console.log('Emitting match:toss...');
  const pToss2 = waitForEvent(socketHost, 'state:update');
  socketHost.emit('match:toss', { winner: 'team1', choice: 'bat' });
  await pToss2;
  console.log('✅ Toss done');

  // Set opening batsmen and bowler
  socketHost.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Alpha 1',
    nonStriker: 'Alpha 2',
    isSingleBatter: false
  });
  await waitForEvent(socketHost, 'state:update');

  socketHost.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Beta 1'
  });
  await waitForEvent(socketHost, 'state:update');

  // Score some runs
  socketHost.emit('score:ball', {
    inningsIdx: 0,
    runs: 4,
    extras: null,
    wicket: false,
    dismissal: null
  });
  await waitForEvent(socketHost, 'state:update');

  // Wicket falls -> awaitingNewBatsman = true
  socketHost.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    extras: null,
    wicket: true,
    dismissal: 'bowled'
  });
  const stateAfterWicket = await waitForEvent(socketHost, 'state:update');
  if (!stateAfterWicket.match.innings[0].awaitingNewBatsman) {
    throw new Error('Expected awaitingNewBatsman to be true after wicket');
  }
  console.log('✅ PASS: Wicket modal ready, score is 4/1');

  // 2. Click "All Out / End Innings" from modal
  const pState2 = waitForEvent(socketHost, 'state:update');
  const ackEndInnings = await new Promise((resolve) => {
    socketHost.emit('score:endInnings', { inningsIdx: 0 }, (res) => resolve(res));
  });
  const stateInnings2 = await pState2;

  if (!ackEndInnings || !ackEndInnings.success) {
    throw new Error(`score:endInnings failed with response: ${JSON.stringify(ackEndInnings)}`);
  }
  if (stateInnings2.match.status !== 'innings2' || stateInnings2.match.currentInnings !== 1) {
    throw new Error(`Expected match status to be 'innings2', got '${stateInnings2.match.status}'`);
  }
  if (stateInnings2.match.innings[1].target !== 5) {
    throw new Error(`Expected target to be 5, got ${stateInnings2.match.innings[1].target}`);
  }
  console.log('✅ PASS: Innings 1 declared All Out! Innings 2 target correctly set to 5.');

  // 3. Set Innings 2 opening batsmen & bowler
  socketHost.emit('score:setBatsmen', {
    inningsIdx: 1,
    striker: 'Beta 1',
    nonStriker: 'Beta 2',
    isSingleBatter: false
  });
  await waitForEvent(socketHost, 'state:update');
  socketHost.emit('score:setBowler', {
    inningsIdx: 1,
    bowlerName: 'Alpha 1'
  });
  await waitForEvent(socketHost, 'state:update');

  // Score 2 runs in Innings 2
  socketHost.emit('score:ball', {
    inningsIdx: 1,
    runs: 2,
    extras: null,
    wicket: false,
    dismissal: null
  });
  await waitForEvent(socketHost, 'state:update');

  // 4. Declare All Out in Innings 2 directly from scoring panel
  const pStateCompleted = waitForEvent(socketHost, 'state:update');
  const ackEndInnings2 = await new Promise((resolve) => {
    socketHost.emit('score:endInnings', { inningsIdx: 1 }, (res) => resolve(res));
  });
  const stateCompleted = await pStateCompleted;

  if (!ackEndInnings2 || !ackEndInnings2.success) {
    throw new Error(`score:endInnings on 2nd innings failed: ${JSON.stringify(ackEndInnings2)}`);
  }
  if (stateCompleted.match.status !== 'completed') {
    throw new Error(`Expected match status 'completed', got '${stateCompleted.match.status}'`);
  }
  if (!stateCompleted.match.result) {
    throw new Error('Expected match result to be calculated');
  }
  console.log(`✅ PASS: Innings 2 declared All Out! Match completed. Result: ${stateCompleted.match.result.statement}`);

  socketHost.disconnect();
  console.log('\n🎉 ALL ALL-OUT / END INNINGS TESTS PASSED 100%!');
}

testDeclareAllOutFlow().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
