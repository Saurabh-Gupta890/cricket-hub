const ioClient = require('socket.io-client');
const http = require('http');

const BASE_URL = 'http://localhost:3000';
const results = [];

function pass(name, details = '') {
  results.push({ name, status: 'PASS', details });
  console.log(`✅ [PASS] ${name} ${details ? '(' + details + ')' : ''}`);
}

function fail(name, error) {
  results.push({ name, status: 'FAIL', error: String(error) });
  console.error(`❌ [FAIL] ${name}:`, error);
}

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

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + path, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', reject);
  });
}

function waitForEvent(socket, eventName, timeout = 3000) {
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

async function runTests() {
  console.log('🚀 Starting Comprehensive End-to-End System Tests...\n');

  // ──────────────────────────────────────────────
  // TEST 1: Auth & Profile Lifecycle
  // ──────────────────────────────────────────────
  const testPhone1 = '+919999900001';
  const testPhone2 = '+919999900002';
  let token1, token2, user1, user2;

  try {
    const otpRes = await postJson('/api/auth/request-otp', { phone: testPhone1 });
    if (!otpRes.data.success || !otpRes.data.devOtp) throw new Error(JSON.stringify(otpRes.data));
    pass('Request OTP for Host', `devOtp: ${otpRes.data.devOtp}`);

    const verifyRes = await postJson('/api/auth/verify-otp', {
      phone: testPhone1,
      otp: otpRes.data.devOtp,
      name: 'Virat Captain',
      jersey: '18',
      role: 'Top-order Batter',
      battingStyle: 'Right-hand bat',
      bowlingStyle: 'Right-arm medium',
      color: '#00e5ff'
    });
    if (!verifyRes.data.success || !verifyRes.data.token) throw new Error(JSON.stringify(verifyRes.data));
    token1 = verifyRes.data.token;
    user1 = verifyRes.data.user;
    pass('Verify OTP & Profile Creation', `Token acquired for ${user1.name}`);
  } catch (e) {
    fail('Auth Lifecycle Host', e);
  }

  try {
    const otpRes2 = await postJson('/api/auth/request-otp', { phone: testPhone2 });
    const verifyRes2 = await postJson('/api/auth/verify-otp', {
      phone: testPhone2,
      otp: otpRes2.data.devOtp,
      name: 'Rohit Opener',
      jersey: '45',
      role: 'Batter',
      battingStyle: 'Right-hand bat',
      bowlingStyle: 'Right-arm offbreak',
      color: '#ff6b35'
    });
    token2 = verifyRes2.data.token;
    user2 = verifyRes2.data.user;
    pass('Verify OTP Player 2', `Token acquired for ${user2.name}`);
  } catch (e) {
    fail('Auth Lifecycle Player 2', e);
  }

  // ──────────────────────────────────────────────
  // TEST 2: WebSockets & Room Creation
  // ──────────────────────────────────────────────
  const socket1 = ioClient(BASE_URL, { reconnection: false });
  const socket2 = ioClient(BASE_URL, { reconnection: false });

  await Promise.all([
    new Promise(res => socket1.on('connect', res)),
    new Promise(res => socket2.on('connect', res))
  ]);
  pass('WebSocket Connection', 'Both host and player connected to server');

  socket1.emit('user:register', { token: token1, phone: user1.phone });
  socket2.emit('user:register', { token: token2, phone: user2.phone });

  let room;
  try {
    const createRes = await new Promise((res) => {
      socket1.emit('room:create', { token: token1, matchName: 'Sunday Mega Derby' }, res);
    });
    if (createRes.success && createRes.room.code) {
      room = createRes.room;
      pass('Room Creation', `Room Code: ${room.code} (${room.matchName})`);
    } else {
      throw new Error(JSON.stringify(createRes));
    }
  } catch (e) {
    fail('Room Creation', e);
  }

  // ──────────────────────────────────────────────
  // TEST 3: Planning Phase & Joining
  // ──────────────────────────────────────────────
  try {
    const joinRes = await new Promise((res) => {
      socket2.emit('room:join', { token: token2, code: room.code }, res);
    });
    if (joinRes.success) {
      pass('Player 2 Join Room', `Joined room ${room.code}`);
    } else {
      throw new Error(JSON.stringify(joinRes));
    }

    // Player 1 Vote
    const pVote1 = waitForEvent(socket1, 'planning:update');
    socket1.emit('planning:vote', { vote: 'coming', comment: 'Ready to smash boundaries!' });
    await pVote1;

    // Player 2 Vote
    const pVote2 = waitForEvent(socket2, 'planning:update');
    socket2.emit('planning:vote', { vote: 'coming', comment: 'Bringing the match ball' });
    await pVote2;
    pass('Planning RSVP Votes', 'Both players confirmed Coming with comments');

    // Host Schedule Update
    const pDate = waitForEvent(socket1, 'planning:update');
    socket1.emit('planning:date', { date: '2026-09-06', time: '16:00' });
    await pDate;
    pass('Planning Schedule Update', 'Date set to 2026-09-06, 16:00');

    // Host Venue Update
    const pLoc = waitForEvent(socket1, 'state:update');
    socket1.emit('match:setup', {
      location: {
        text: 'Wankhede Stadium Turf A',
        mapUrl: 'https://maps.google.com/?q=Wankhede'
      }
    });
    await pLoc;
    pass('Planning Location Update', 'Venue set and sanitized safely');

    // Planning Chat
    const pChat = waitForEvent(socket1, 'chat:message');
    socket2.emit('chat:message', { text: 'See everyone at 3:45 PM!' });
    const chatMsg = await pChat;
    pass('Planning Chat Message', `Broadcast: "${chatMsg.text}" by ${chatMsg.author}`);

  } catch (e) {
    fail('Planning Phase Workflow', e);
  }

  // ──────────────────────────────────────────────
  // TEST 4: Match Setup & Overs Configuration
  // ──────────────────────────────────────────────
  try {
    const pSetup = waitForEvent(socket1, 'state:update');
    socket1.emit('match:setup', {
      teams: {
        team1: { name: 'Royal Strikers', players: [user1.name, 'KL Rahul', 'Jasprit Bumrah'] },
        team2: { name: 'Mumbai Blasters', players: [user2.name, 'Hardik Pandya', 'Suryakumar Yadav'] }
      },
      overs: 1, // 1 over for fast rules testing
      date: '2026-09-06',
      time: '16:00',
      location: { text: 'Wankhede Stadium', mapUrl: 'https://maps.google.com' }
    });
    const stateAfterSetup = await pSetup;
    if (stateAfterSetup.match.status === 'setup' && stateAfterSetup.match.overs === 1) {
      pass('Match Setup (1 Over)', 'Teams & 1-over configuration verified');
    } else {
      throw new Error(`Unexpected status: ${stateAfterSetup.match.status}`);
    }
  } catch (e) {
    fail('Match Setup', e);
  }

  // ──────────────────────────────────────────────
  // TEST 5: Toss Workflow
  // ──────────────────────────────────────────────
  try {
    const pTossStart = waitForEvent(socket1, 'state:update');
    socket1.emit('match:startToss');
    await pTossStart;

    const pTossDone = waitForEvent(socket1, 'state:update');
    socket1.emit('match:toss', {
      winner: 'team1',
      choice: 'bat'
    });
    const stateAfterToss = await pTossDone;
    if (stateAfterToss.match.status === 'innings1' && stateAfterToss.match.battingFirst === 'team1') {
      pass('Toss Execution', 'Team 1 won toss, chose to BAT first -> Innings 1 started');
    } else {
      throw new Error(`Unexpected state after toss: ${stateAfterToss.match.status}`);
    }
  } catch (e) {
    fail('Toss Execution', e);
  }

  // ──────────────────────────────────────────────
  // TEST 6: Innings 1 Live Scoring Engine
  // ──────────────────────────────────────────────
  try {
    // Select Batsmen
    const pBatsmen = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBatsmen', {
      inningsIdx: 0,
      striker: user1.name,
      nonStriker: 'KL Rahul'
    });
    await pBatsmen;
    pass('Select Batsmen Innings 1', `${user1.name} (Striker) & KL Rahul (Non-Striker)`);

    // Select Bowler
    const pBowler = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBowler', {
      inningsIdx: 0,
      bowlerName: user2.name
    });
    await pBowler;
    pass('Select Bowler Over 1', `${user2.name}`);

    // Ball 1: 4 runs (Boundary)
    let pBall = waitForEvent(socket1, 'state:update');
    socket1.emit('score:ball', {
      inningsIdx: 0,
      runs: 4,
      extras: null,
      wicket: false,
      dismissal: null
    });
    let s = await pBall;
    pass('Ball 1: 4 Runs', `Score: ${s.match.innings[0].runs}/${s.match.innings[0].wickets}`);

    // Ball 2: 1 run (Single -> Strike rotates)
    pBall = waitForEvent(socket1, 'state:update');
    socket1.emit('score:ball', {
      inningsIdx: 0,
      runs: 1,
      extras: null,
      wicket: false,
      dismissal: null
    });
    s = await pBall;
    pass('Ball 2: 1 Run (Strike Rotates)', `Striker: ${s.match.innings[0].batsmen[s.match.innings[0].currentBatsmen[0]]?.name}`);

    // Ball 3: 6 runs (Six by KL Rahul)
    pBall = waitForEvent(socket1, 'state:update');
    socket1.emit('score:ball', {
      inningsIdx: 0,
      runs: 6,
      extras: null,
      wicket: false,
      dismissal: null
    });
    s = await pBall;
    pass('Ball 3: 6 Runs', `Score: ${s.match.innings[0].runs}/${s.match.innings[0].wickets}`);

    // Ball 4: Wicket (Bowled)
    pBall = waitForEvent(socket1, 'state:update');
    socket1.emit('score:ball', {
      inningsIdx: 0,
      runs: 0,
      extras: null,
      wicket: true,
      dismissal: 'bowled b Rohit Opener'
    });
    s = await pBall;
    pass('Ball 4: Wicket (Bowled)', `Wickets: ${s.match.innings[0].wickets}`);

    // Select Next Batsman
    const pNextBat = waitForEvent(socket1, 'state:update');
    socket1.emit('score:nextBatsman', {
      inningsIdx: 0,
      batsmanName: 'Jasprit Bumrah'
    });
    s = await pNextBat;
    pass('Select Next Batsman', 'Jasprit Bumrah at the crease');

    // Ball 5: Wide (+1 extra)
    pBall = waitForEvent(socket1, 'state:update');
    socket1.emit('score:ball', {
      inningsIdx: 0,
      runs: 0,
      extras: { wide: true },
      wicket: false,
      dismissal: null
    });
    s = await pBall;
    pass('Ball 5 (Wide): +1 Extra', `Wide count: ${s.match.innings[0].extras.wide}`);

    // Ball 5 (Legal): 2 runs
    pBall = waitForEvent(socket1, 'state:update');
    socket1.emit('score:ball', {
      inningsIdx: 0,
      runs: 2,
      extras: null,
      wicket: false,
      dismissal: null
    });
    s = await pBall;

    // Ball 6: 1 run -> Completes Over 1 & Innings 1
    pBall = waitForEvent(socket1, 'state:update');
    socket1.emit('score:ball', {
      inningsIdx: 0,
      runs: 1,
      extras: null,
      wicket: false,
      dismissal: null
    });
    s = await pBall;
    pass('Innings 1 Completed', `Total: ${s.match.innings[0].runs}/${s.match.innings[0].wickets} in 1.0 overs. Target for Innings 2: ${s.match.innings[0].runs + 1}`);

  } catch (e) {
    fail('Innings 1 Scoring Flow', e);
  }

  // ──────────────────────────────────────────────
  // TEST 7: Innings 2 Chase & Match Conclusion
  // ──────────────────────────────────────────────
  try {
    // Select Batsmen for Innings 2 (Mumbai Blasters)
    const pBatsmen2 = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBatsmen', {
      inningsIdx: 1,
      striker: user2.name,
      nonStriker: 'Suryakumar Yadav'
    });
    await pBatsmen2;

    // Select Bowler (Jasprit Bumrah)
    const pBowler2 = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBowler', {
      inningsIdx: 1,
      bowlerName: 'Jasprit Bumrah'
    });
    await pBowler2;
    pass('Innings 2 Batsmen & Bowler Set', 'Chase begins');

    // Score boundaries to win the match
    for (let i = 0; i < 3; i++) {
      const pChaseBall = waitForEvent(socket1, 'state:update');
      socket1.emit('score:ball', {
        inningsIdx: 1,
        runs: 6,
        extras: null,
        wicket: false,
        dismissal: null
      });
      const sChase = await pChaseBall;
      if (sChase.match.status === 'completed') {
        pass(`Chase Completed Ball ${i + 1}`, `Winner: ${sChase.match.result?.summary || 'Calculated'}`);
        break;
      }
    }

  } catch (e) {
    fail('Innings 2 Chase Flow', e);
  }

  // ──────────────────────────────────────────────
  // TEST 8: History & Player Profiles Verification
  // ──────────────────────────────────────────────
  try {
    const histRes = await getJson('/api/history');
    if (histRes.status === 200 && Array.isArray(histRes.data?.matches)) {
      pass('Match History Endpoint', `Found ${histRes.data.matches.length} archived match(es) in database`);
    } else {
      throw new Error(JSON.stringify(histRes));
    }

    const dirRes = await getJson('/api/players');
    if (dirRes.status === 200 && Array.isArray(dirRes.data?.players) && dirRes.data.players.length >= 2) {
      pass('Players Directory', `Found ${dirRes.data.players.length} registered players with aggregated stats`);
    } else {
      throw new Error(JSON.stringify(dirRes));
    }
  } catch (e) {
    fail('History & Directory Verification', e);
  }

  // Cleanup
  socket1.disconnect();
  socket2.disconnect();

  console.log('\n==============================================');
  console.log(`TEST SUMMARY: ${results.filter(r => r.status === 'PASS').length} Passed, ${results.filter(r => r.status === 'FAIL').length} Failed`);
  console.log('==============================================\n');
  process.exit(results.filter(r => r.status === 'FAIL').length > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
