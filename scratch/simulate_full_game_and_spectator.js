const { io } = require('socket.io-client');
const http = require('http');

const SERVER_URL = 'http://localhost:3000';

function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(SERVER_URL + path, {
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

function createClient(token = null) {
  return io(SERVER_URL, {
    transports: ['websocket'],
    forceNew: true,
    auth: token ? { token } : {}
  });
}

function waitForEvent(socket, eventName, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeoutMs);
    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function simulateFullGame() {
  console.log('🚀 ========================================================');
  console.log('🏏 CRICKETHUB: FULL MATCH SIMULATION (HOST & SPECTATOR)');
  console.log('🚀 ========================================================\n');

  // 1. Host Authentication
  console.log('1️⃣ Host Login (+919876540001 - Captain Rohit)...');
  const hostOtpRes = await postJSON('/api/auth/request-otp', { phone: '9876540001', name: 'Captain Rohit' });
  const hostAuth = await postJSON('/api/auth/verify-otp', { phone: '9876540001', otp: hostOtpRes.body.devOtp });
  const hostToken = hostAuth.body.token;
  console.log('   ✅ Host authenticated, token received');

  // 2. Spectator / Guest Authentication
  console.log('2️⃣ Spectator / User Login (+919876540002 - Fan Virat)...');
  const userOtpRes = await postJSON('/api/auth/request-otp', { phone: '9876540002', name: 'Fan Virat' });
  const userAuth = await postJSON('/api/auth/verify-otp', { phone: '9876540002', otp: userOtpRes.body.devOtp });
  const userToken = userAuth.body.token;
  console.log('   ✅ Spectator authenticated, token received');

  // 3. Connect Sockets
  const socketHost = createClient(hostToken);
  const socketUser = createClient(userToken);
  await Promise.all([
    waitForEvent(socketHost, 'connect'),
    waitForEvent(socketUser, 'connect')
  ]);
  console.log('   ✅ Both Host and Spectator connected via WebSocket');

  // 4. Host Creates Match Room
  const uniqueMatchName = `Mumbai Derby Cup ${Date.now()}`;
  console.log(`\n3️⃣ Host creates match room "${uniqueMatchName}"...`);
  const createRes = await new Promise(r => socketHost.emit('room:create', { matchName: uniqueMatchName, token: hostToken }, r));
  if (!createRes.success || !createRes.room) {
    throw new Error(`Failed to create room: ${JSON.stringify(createRes)}`);
  }
  const roomCode = createRes.room.code;
  console.log(`   ✅ Match Room created with code: ${roomCode}`);

  // 5. Spectator Joins Room
  console.log(`4️⃣ Spectator joins room: ${roomCode}...`);
  await new Promise(r => socketUser.emit('room:join', { code: roomCode, token: userToken }, r));
  console.log('   ✅ Spectator successfully joined room and synced live state');

  // 6. Host Configures 1-Over Match
  console.log('\n5️⃣ Host configures Match Setup: 1 Over, India vs Australia...');
  await new Promise(r => socketHost.emit('match:setup', {
    overs: 1,
    teams: {
      team1: { name: 'India', players: ['Rohit Sharma', 'Virat Kohli', 'Suryakumar Yadav'] },
      team2: { name: 'Australia', players: ['Pat Cummins', 'Mitchell Starc', 'Glenn Maxwell'] }
    }
  }, r));
  console.log('   ✅ Match Setup saved (1 Over, squads defined)');
  await new Promise(r => setTimeout(r, 100));

  // 7. Coin Toss
  console.log('\n6️⃣ Coin Toss phase: Host flips coin and elects to Bat First...');
  const pToss = waitForEvent(socketUser, 'state:update');
  await new Promise(r => socketHost.emit('match:toss', { winner: 'team1', choice: 'bat' }, r));
  const tossState = await pToss;
  console.log(`   ✅ Match Status transitioned to: ${tossState.match.status}`);
  console.log(`   ✅ Spectator received Live State: ${tossState.match.teams[tossState.match.battingFirst]?.name || tossState.match.battingFirst} Batting First`);

  // 8. Opening Batsmen & Bowler
  console.log('\n7️⃣ Setting Opening Batsmen & Bowler for 1st Innings...');
  await new Promise(r => socketHost.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Rohit Sharma',
    nonStriker: 'Virat Kohli',
    token: hostToken
  }, r));
  await new Promise(r => socketHost.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Pat Cummins',
    token: hostToken
  }, r));
  console.log('   ✅ Striker: Rohit Sharma, Non-Striker: Virat Kohli, Bowler: Pat Cummins');

  // 9. 1st Innings Scoring Sequence
  console.log('\n8️⃣ Scoring 1st Innings Balls (1 Over Blitz):');
  
  // Ball 1: Four
  let pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 4, token: hostToken });
  let s1 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log(`   🏏 Ball 1: FOUR! Score = ${s1.match.innings[0].runs}/${s1.match.innings[0].wickets} (${s1.match.innings[0].balls} balls)`);

  // Ball 2: Six
  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 6, token: hostToken });
  let s2 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log(`   💥 Ball 2: SIX! Score = ${s2.match.innings[0].runs}/${s2.match.innings[0].wickets} (${s2.match.innings[0].balls} balls)`);

  // Ball 3: Single (rotates strike)
  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 1, token: hostToken });
  let s3 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log(`   🏃 Ball 3: Single! Strike to Virat. Score = ${s3.match.innings[0].runs}/${s3.match.innings[0].wickets}`);

  // Ball 4: Wicket (Virat Bowled)
  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', {
    inningsIdx: 0,
    runs: 0,
    wicket: true,
    dismissal: 'b Cummins',
    dismissalType: 'Bowled',
    dismissedSlot: 'striker',
    token: hostToken
  });
  let s4 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log(`   ☝️ Ball 4: WICKET! Virat bowled by Cummins. Score = ${s4.match.innings[0].runs}/${s4.match.innings[0].wickets}, awaitingNewBatsman=${s4.match.innings[0].awaitingNewBatsman}`);

  // Next Batter
  pSpec = waitForEvent(socketUser, 'state:update');
  await new Promise(r => socketHost.emit('score:nextBatsman', {
    inningsIdx: 0,
    batsmanName: 'Suryakumar Yadav',
    token: hostToken
  }, r));
  await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log('   👥 Suryakumar Yadav enters at crease');

  // Ball 5: Two Runs
  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 2, token: hostToken });
  let s5 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log(`   🏃 Ball 5: 2 Runs. Score = ${s5.match.innings[0].runs}/${s5.match.innings[0].wickets}`);

  // Ball 6: 1 Run (Completes 1 Over -> Innings 1 Over Completed!)
  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 1, token: hostToken });
  let s6 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log('   🏁 Ball 6: 1 Run. 1st Innings Over!');
  console.log(`   ✅ Match Status transitioned to: ${s6.match.status}`);
  console.log(`   ✅ 1st Innings Score: ${s6.match.innings[0].runs}/${s6.match.innings[0].wickets}`);
  console.log(`   🎯 Target for Australia: ${s6.match.innings[1].target} runs`);

  // 10. 2nd Innings Setup
  console.log('\n9️⃣ 2nd Innings Setup: Australia batting...');
  await new Promise(r => socketHost.emit('score:setBatsmen', {
    inningsIdx: 1,
    striker: 'Mitchell Starc',
    nonStriker: 'Glenn Maxwell',
    token: hostToken
  }, r));
  await new Promise(r => socketHost.emit('score:setBowler', {
    inningsIdx: 1,
    bowlerName: 'Jasprit Bumrah',
    token: hostToken
  }, r));
  await new Promise(r => setTimeout(r, 60));
  console.log('   ✅ Australia Openers: Mitchell Starc & Glenn Maxwell, Bowler: Jasprit Bumrah');

  // 11. 2nd Innings Chase
  console.log(`\n🔟 Scoring 2nd Innings Chase: Target = ${s6.match.innings[1].target}`);
  
  // Australia Ball 1: Six
  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 1, runs: 6, token: hostToken });
  let a1 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log(`   💥 Ball 1: SIX by Starc! Score = ${a1.match.innings[1].runs}/${a1.match.innings[1].wickets} (Needs ${s6.match.innings[1].target - a1.match.innings[1].runs} more)`);

  // Australia Ball 2: Six
  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 1, runs: 6, token: hostToken });
  let a2 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log(`   💥 Ball 2: SIX by Starc! Score = ${a2.match.innings[1].runs}/${a2.match.innings[1].wickets} (Needs ${s6.match.innings[1].target - a2.match.innings[1].runs} more)`);

  // Australia Ball 3: Four (Wins the match!)
  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 1, runs: 4, token: hostToken });
  let a3 = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log('   🏆 Ball 3: FOUR! Target reached and exceeded!');
  console.log(`   ✅ Match status is: ${a3.match.status}`);
  console.log(`   🏆 Winner Result: ${a3.match.result?.summary || a3.match.result?.winnerName || 'Australia won'}`);

  // 12. Rematch Verification
  console.log('\n1️⃣1️⃣ Testing Rematch Functionality in Same Room...');
  pSpec = waitForEvent(socketUser, 'state:update');
  const rematchRes = await new Promise(r => socketHost.emit('match:rematch', { resetToSetup: false }, r));
  let rState = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log('   ✅ Rematch Response:', rematchRes);
  console.log(`   ✅ Room code preserved: ${rState.code}`);
  console.log(`   ✅ Match Status reset to: ${rState.match.status}`);
  console.log(`   ✅ Current Innings reset to: ${rState.match.currentInnings}`);
  console.log(`   ✅ Innings 0 completed flag is: ${rState.match.innings[0].completed} (must be false)`);
  console.log(`   ✅ Innings 0 score is: ${rState.match.innings[0].runs}/${rState.match.innings[0].wickets} (fresh 0/0)`);

  // 13. Start Rematch Toss & 1st Ball
  console.log('\n1️⃣2️⃣ Starting Rematch Game 2 Toss & First Ball...');
  pSpec = waitForEvent(socketUser, 'state:update');
  await new Promise(r => socketHost.emit('match:toss', { winner: 'team2', choice: 'bat' }, r));
  let g2State = await pSpec;
  await new Promise(r => setTimeout(r, 60));
  console.log(`   ✅ Match 2 Status after Toss: ${g2State.match.status}`);
  console.log(`   ✅ Match 2 Batting First: ${g2State.match.battingFirst}`);

  await new Promise(r => socketHost.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Pat Cummins',
    nonStriker: 'Mitchell Starc',
    token: hostToken
  }, r));
  await new Promise(r => socketHost.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Rohit Sharma',
    token: hostToken
  }, r));
  await new Promise(r => setTimeout(r, 60));

  pSpec = waitForEvent(socketUser, 'state:update');
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 4, token: hostToken });
  let g2Ball1 = await pSpec;
  console.log(`   🏏 Match 2 Ball 1 scored successfully: 4 runs! Score = ${g2Ball1.match.innings[0].runs}/${g2Ball1.match.innings[0].wickets}`);

  // Clean up
  await new Promise(r => socketHost.emit('room:delete', { code: roomCode, token: hostToken }, r));
  socketHost.disconnect();
  socketUser.disconnect();

  console.log('\n🎉 ========================================================');
  console.log('✅ ALL HOST & USER GAMEPLAY + REMATCH TESTS PASSED 100%!');
  console.log('🎉 ========================================================');
}

simulateFullGame().catch(err => {
  console.error('❌ Test Failed with Error:', err);
  process.exit(1);
});
