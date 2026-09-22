const { io } = require('socket.io-client');
const http = require('http');

const SERVER_URL = 'http://localhost:3000';

function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(`${SERVER_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(chunks) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: chunks });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function createClient(token = null) {
  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
    auth: token ? { token } : {}
  });
  return socket;
}

async function runE2ETests() {
  console.log('🚀 ========================================================');
  console.log('🏏 CRICKETHUB COMPLETE END-TO-END SCORING & AI COMMENTARY TEST');
  console.log('🚀 ========================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  try {
    // ─── 1. User Authentication (Host & Guest) ─────────────
    console.log('1️⃣ Testing Authentication & Sessions...');
    const hostPhone = '919999000001';
    const guestPhone = '919999000002';

    const hostOtp = await postJSON('/api/auth/request-otp', { phone: hostPhone, name: 'Host Captain' });
    assert(hostOtp.body.success, 'Host OTP requested');

    const hostVerify = await postJSON('/api/auth/verify-otp', { phone: hostPhone, otp: hostOtp.body.devOtp || '123456' });
    assert(hostVerify.body.success && hostVerify.body.token, 'Host verified and token received');
    const hostToken = hostVerify.body.token;

    const guestOtp = await postJSON('/api/auth/request-otp', { phone: guestPhone, name: 'Spectator User' });
    const guestVerify = await postJSON('/api/auth/verify-otp', { phone: guestPhone, otp: guestOtp.body.devOtp || '123456' });
    assert(guestVerify.body.success && guestVerify.body.token, 'Guest verified and token received');
    const guestToken = guestVerify.body.token;

    // ─── 2. Connect WebSockets ─────────────────────────────
    console.log('\n2️⃣ Connecting WebSockets...');
    const hostSocket = createClient(hostToken);
    const guestSocket = createClient(guestToken);

    await new Promise((resolve) => {
      let count = 0;
      const done = () => { if (++count === 2) resolve(); };
      hostSocket.on('connect', done);
      guestSocket.on('connect', done);
    });
    assert(hostSocket.connected && guestSocket.connected, 'Both sockets connected via WebSocket');

    // ─── 3. Room Creation & Uniqueness ─────────────────────
    console.log('\n3️⃣ Testing Match Room Creation & Unique Names...');
    const matchName = `E2E Cup Final ${Date.now()}`;
    const createRes = await new Promise((resolve) => {
      hostSocket.emit('room:create', {
        matchName: matchName,
        overs: 2,
        teamAName: 'India',
        teamBName: 'Australia',
        token: hostToken
      }, resolve);
    });
    const roomCode = createRes.room?.code;
    assert(createRes.success && roomCode, `Room created with code: ${roomCode}`);

    // Test duplicate creation prevention
    const dupRes = await new Promise((resolve) => {
      hostSocket.emit('room:create', {
        matchName: matchName,
        overs: 2,
        teamAName: 'India',
        teamBName: 'Australia',
        token: hostToken
      }, resolve);
    });
    assert(!dupRes.success && dupRes.error && dupRes.error.includes('already active'), 'Duplicate room name successfully rejected');

    // Guest joins room
    const joinRes = await new Promise((resolve) => {
      guestSocket.emit('room:join', { code: roomCode, token: guestToken }, resolve);
    });
    assert(joinRes.success, 'Guest successfully joined room');

    // ─── 4. Planning & Match Setup ─────────────────────────
    console.log('\n4️⃣ Testing Planning & Match Setup...');
    // Add announcement
    hostSocket.emit('announcement:add', { text: 'Welcome to the Grand Final!' });
    await wait(200);

    // Setup teams, overs, and players
    const setupRes = await new Promise((resolve) => {
      hostSocket.emit('match:setup', {
        overs: 1, // 1 over innings for fast, complete E2E cycle
        team1: { name: 'India', players: ['Rohit', 'Virat', 'Surya', 'Hardik'] },
        team2: { name: 'Australia', players: ['Cummins', 'Starc', 'Head', 'Warner'] }
      }, resolve);
    });
    assert(setupRes.success, 'Match setup saved: 1 Over, India vs Australia squads configured');

    // Start Toss phase
    hostSocket.emit('match:startToss');
    await wait(300);

    // ─── 5. Coin Toss ──────────────────────────────────────
    console.log('\n5️⃣ Testing Coin Toss Phase...');
    let currentRoomState = null;
    hostSocket.on('state:update', (room) => {
      currentRoomState = room;
    });

    hostSocket.emit('match:toss', { winner: 'team1', choice: 'bat' });
    await wait(300);
    assert(currentRoomState?.match?.status === 'innings1', 'Toss processed: India batting in 1st Innings');

    // ─── 6. Opening Batsmen & Bowler Initialization ────────
    console.log('\n6️⃣ Testing Opening Batsmen & Bowler Setup...');
    const setBatsmenRes = await new Promise((resolve) => {
      hostSocket.emit('score:setBatsmen', {
        inningsIdx: 0,
        striker: 'Rohit',
        nonStriker: 'Virat',
        isSingleBatter: false,
        token: hostToken
      }, resolve);
    });
    assert(setBatsmenRes.success, 'Opening batsmen set: Striker=Rohit, Non-Striker=Virat');

    const setBowlerRes = await new Promise((resolve) => {
      hostSocket.emit('score:setBowler', {
        inningsIdx: 0,
        bowlerName: 'Cummins',
        token: hostToken
      }, resolve);
    });
    assert(setBowlerRes.success, 'Opening bowler set: Cummins');

    // ─── 7. Ball-by-Ball Scoring Sequence ──────────────────
    console.log('\n7️⃣ Executing Comprehensive Ball Scoring Sequence...');

    // Ball 1: Dot Ball (0 runs)
    hostSocket.emit('score:ball', {
      inningsIdx: 0,
      runs: 0,
      extras: null,
      wicket: false,
      token: hostToken
    });
    await wait(200);
    let inn0 = currentRoomState.match.innings[0];
    assert(inn0.balls === 1 && inn0.runs === 0 && inn0.currentOver[0] === '0', 'Ball 1 (Dot): 0 runs, balls=1, score=0/0');

    // Ball 2: Single (1 run) -> Strike rotates
    hostSocket.emit('score:ball', {
      inningsIdx: 0,
      runs: 1,
      extras: null,
      wicket: false,
      token: hostToken
    });
    await wait(200);
    inn0 = currentRoomState.match.innings[0];
    assert(inn0.balls === 2 && inn0.runs === 1 && inn0.batsmen[inn0.currentBatsmen[0]].name === 'Virat', 'Ball 2 (Single): Strike rotated to Virat, score=1/0');

    // Ball 3: Boundary (4 runs)
    hostSocket.emit('score:ball', {
      inningsIdx: 0,
      runs: 4,
      extras: null,
      wicket: false,
      token: hostToken
    });
    await wait(200);
    inn0 = currentRoomState.match.innings[0];
    assert(inn0.balls === 3 && inn0.runs === 5 && inn0.batsmen[inn0.currentBatsmen[0]].fours === 1, 'Ball 3 (Four): Virat hit 4, score=5/0');

    // Ball 4: Maximum (6 runs)
    hostSocket.emit('score:ball', {
      inningsIdx: 0,
      runs: 6,
      extras: null,
      wicket: false,
      token: hostToken
    });
    await wait(200);
    inn0 = currentRoomState.match.innings[0];
    assert(inn0.balls === 4 && inn0.runs === 11 && inn0.batsmen[inn0.currentBatsmen[0]].sixes === 1, 'Ball 4 (Six): Virat hit 6, score=11/0');

    // Ball 4b (Extra Wide): +1 run, ball count doesn't advance
    hostSocket.emit('score:ball', {
      inningsIdx: 0,
      runs: 0,
      extras: { wide: true },
      wicket: false,
      token: hostToken
    });
    await wait(200);
    inn0 = currentRoomState.match.innings[0];
    assert(inn0.balls === 4 && inn0.runs === 12 && inn0.extras.wide === 1, 'Ball 4b (Wide): Wide +1, balls remained 4, score=12/0');

    // Ball 5: Wicket (Bowled) -> Virat Out
    hostSocket.emit('score:ball', {
      inningsIdx: 0,
      runs: 0,
      extras: null,
      wicket: true,
      dismissalType: 'Bowled',
      dismissedSlot: 'striker',
      token: hostToken
    });
    await wait(200);
    inn0 = currentRoomState.match.innings[0];
    assert(inn0.wickets === 1 && inn0.awaitingNewBatsman === true && inn0.bowlers[0].wickets === 1, 'Ball 5 (Wicket): Virat bowled, wickets=1, awaitingNewBatsman=true, bowler credited with wicket');

    // Set Next Batsman: Surya
    const nextBatRes = await new Promise((resolve) => {
      hostSocket.emit('score:nextBatsman', {
        inningsIdx: 0,
        batsmanName: 'Surya',
        token: hostToken
      }, resolve);
    });
    await wait(200);
    inn0 = currentRoomState.match.innings[0];
    assert(nextBatRes.success && inn0.awaitingNewBatsman === false && inn0.batsmen[inn0.currentBatsmen[0]].name === 'Surya', 'Next Batsman Surya joined at crease, awaitingNewBatsman cleared');

    // Ball 6: 2 Runs -> 1st Innings Overs Limit (1.0 over) Reached!
    hostSocket.emit('score:ball', {
      inningsIdx: 0,
      runs: 2,
      extras: null,
      wicket: false,
      token: hostToken
    });
    await wait(300);
    assert(currentRoomState.match.status === 'innings2' && currentRoomState.match.currentInnings === 1, 'Innings 1 Over completed: Target calculated, transitioned to Innings 2');

    const target = currentRoomState.match.innings[1].target;
    assert(target === 15, `Target for Australia correctly calculated: 14 + 1 = ${target}`);

    // ─── 8. 2nd Innings Scoring & Target Chase ─────────────
    console.log('\n8️⃣ Testing 2nd Innings Chase & Match Completion...');

    // Set Australia Batsmen & Bowler
    await new Promise((resolve) => {
      hostSocket.emit('score:setBatsmen', {
        inningsIdx: 1,
        striker: 'Warner',
        nonStriker: 'Head',
        isSingleBatter: false,
        token: hostToken
      }, resolve);
    });

    await new Promise((resolve) => {
      hostSocket.emit('score:setBowler', {
        inningsIdx: 1,
        bowlerName: 'Bumrah',
        token: hostToken
      }, resolve);
    });
    await wait(200);

    // Australia scores 6 + 6 + 4 = 16 runs (chasing target 15)
    hostSocket.emit('score:ball', { inningsIdx: 1, runs: 6, token: hostToken });
    await wait(150);
    hostSocket.emit('score:ball', { inningsIdx: 1, runs: 6, token: hostToken });
    await wait(150);
    hostSocket.emit('score:ball', { inningsIdx: 1, runs: 4, token: hostToken });
    await wait(300);

    assert(currentRoomState.match.status === 'completed', 'Australia reached target: Match status = "completed"');

    // ─── 9. AI Live Commentary TTS API & Personas ──────────
    console.log('\n9️⃣ Testing AI Live Commentary Engine & TTS Endpoint...');

    const ttsShastri = await postJSON('/api/ai/tts', {
      text: 'What a magnificent strike! That went like a tracer bullet for four!',
      persona: 'shastri'
    });
    assert(ttsShastri.status === 200, 'Shastri TTS request returned 200 OK');

    const ttsBhogle = await postJSON('/api/ai/tts', {
      text: 'Pure velvet timing! Caressed through the extra cover boundary with supreme elegance!',
      persona: 'bhogle'
    });
    assert(ttsBhogle.status === 200, 'Bhogle TTS request returned 200 OK');

    // ─── 10. Room Deletion Verification ────────────────────
    console.log('\n🔟 Testing Room Deletion & Host Permissions...');

    // Viewer deletion attempt should fail
    const guestDel = await new Promise((resolve) => {
      guestSocket.emit('room:delete', { roomCode, token: guestToken }, resolve);
    });
    assert(!guestDel.success, 'Viewer deletion attempt correctly rejected (Host only)');

    // Host deletion should succeed
    const hostDel = await new Promise((resolve) => {
      hostSocket.emit('room:delete', { roomCode, token: hostToken }, resolve);
    });
    assert(hostDel.success, `Host deleted room ${roomCode} successfully`);

    // Disconnect sockets
    hostSocket.disconnect();
    guestSocket.disconnect();

    console.log('\n========================================================');
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('💥 Unhandled error during E2E testing:', err);
    process.exit(1);
  }
}

runE2ETests();
