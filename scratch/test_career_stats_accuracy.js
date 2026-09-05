const io = require('socket.io-client');
const http = require('http');

function apiGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

function requestOtp(phone, name) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ phone, name });
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/request-otp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function verifyOtp(phone, otp) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ phone, otp });
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/verify-otp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runTest() {
  console.log('🧪 Starting Career Stats Verification Test...');
  
  const randSuffix = Date.now().toString().slice(-6);
  const testPhoneA = `91981${randSuffix}1`;
  const testPhoneB = `91981${randSuffix}2`;
  
  // 1. Authenticate players
  console.log('\n--- Step 1: Register Player A and Player B ---');
  const otpResA = await requestOtp(testPhoneA, 'Rohit S');
  const userA = await verifyOtp(testPhoneA, otpResA.devOtp);
  console.log('Player A registered:', userA.user.name, userA.user.phone);

  const otpResB = await requestOtp(testPhoneB, 'Bumrah J');
  const userB = await verifyOtp(testPhoneB, otpResB.devOtp);
  console.log('Player B registered:', userB.user.name, userB.user.phone);

  // 2. Check initial profile stats (should be all 0s)
  console.log('\n--- Step 2: Verify Initial Stats are exactly 0 ---');
  const initialProfA = await apiGet(`/api/profile/${testPhoneA}`);
  console.log('Initial A Stats -> Matches:', initialProfA.player.totalMatches, 'Runs:', initialProfA.stats.batting.runs, 'Wickets:', initialProfA.stats.bowling.wickets);
  if (initialProfA.player.totalMatches !== 0 || initialProfA.stats.batting.runs !== 0 || initialProfA.stats.bowling.wickets !== 0) {
    throw new Error('FAILED: Initial player stats are not 0!');
  }
  console.log('✅ Initial profile is clean with 0 matches, 0 runs, 0 wickets');

  // 3. Create a real match room with Player A and Player B
  console.log('\n--- Step 3: Play a Match with explicit scoring ---');
  const sockA = io('http://localhost:3000', { transports: ['websocket'] });
  const sockB = io('http://localhost:3000', { transports: ['websocket'] });

  await new Promise(r => sockA.on('connect', r));
  await new Promise(r => sockB.on('connect', r));

  sockA.emit('user:register', { token: userA.token });
  sockB.emit('user:register', { token: userB.token });

  // Create room
  const roomData = await new Promise(resolve => {
    sockA.emit('room:create', { token: userA.token, matchName: 'Stats Accuracy Test Match' }, resolve);
  });
  const roomCode = roomData.room ? roomData.room.code : roomData.code;
  console.log('Created room:', roomCode);

  // Join room
  await new Promise(resolve => {
    sockB.emit('room:join', { code: roomCode, token: userB.token }, resolve);
  });

  // Setup teams and start match
  const team1 = { name: 'Mumbai Blue', players: [{ id: testPhoneA, name: 'Rohit S', phone: testPhoneA }] };
  const team2 = { name: 'Gujarat Gold', players: [{ id: testPhoneB, name: 'Bumrah J', phone: testPhoneB }] };

  sockA.emit('planning:setupMatch', {
    team1,
    team2,
    overs: 1,
    battingFirst: 'team1',
    toss: { winner: 'team1', choice: 'bat' }
  });

  await new Promise(r => setTimeout(r, 500));
  sockA.emit('match:start');
  await new Promise(r => setTimeout(r, 500));

  // Set batsmen: Striker = Rohit S, Bowler = Bumrah J
  sockA.emit('score:setBatsmen', { inningsIdx: 0, striker: 'Rohit S', nonStriker: 'NonStriker 1' });
  sockA.emit('score:setBowler', { inningsIdx: 0, bowlerName: 'Bumrah J' });
  await new Promise(r => setTimeout(r, 500));

  // Ball 1: 4 runs to Rohit S (off Bumrah J)
  sockA.emit('score:ball', { inningsIdx: 0, runs: 4, extras: null, wicket: false });
  await new Promise(r => setTimeout(r, 200));

  // Ball 2: 6 runs to Rohit S
  sockA.emit('score:ball', { inningsIdx: 0, runs: 6, extras: null, wicket: false });
  await new Promise(r => setTimeout(r, 200));

  // Ball 3: 1 run to Rohit S (rotates strike)
  sockA.emit('score:ball', { inningsIdx: 0, runs: 1, extras: null, wicket: false });
  await new Promise(r => setTimeout(r, 200));

  // Ball 4: Wicket bowled by Bumrah J (striker now NonStriker 1)
  sockA.emit('score:ball', { inningsIdx: 0, runs: 0, extras: null, wicket: true, dismissal: 'bowled' });
  await new Promise(r => setTimeout(r, 200));

  // Ball 5: 2 runs
  sockA.emit('score:ball', { inningsIdx: 0, runs: 2, extras: null, wicket: false });
  await new Promise(r => setTimeout(r, 200));

  // Ball 6: 0 runs
  sockA.emit('score:ball', { inningsIdx: 0, runs: 0, extras: null, wicket: false });
  await new Promise(r => setTimeout(r, 500));

  console.log('\n--- Step 4: Verify Career Stats for Player A (Rohit S) ---');
  const profA = await apiGet(`/api/profile/${testPhoneA}`);
  console.log('Player A Batting -> Runs:', profA.stats.batting.runs, 'Balls:', profA.stats.batting.balls, 'Fours:', profA.stats.batting.fours, 'Sixes:', profA.stats.batting.sixes, 'SR:', profA.stats.batting.strikeRate, 'HS:', profA.stats.batting.highestScore);
  
  if (profA.stats.batting.runs !== 11) {
    throw new Error(`FAILED: Expected 11 runs for Rohit S, got ${profA.stats.batting.runs}`);
  }
  if (profA.stats.batting.balls !== 3) {
    throw new Error(`FAILED: Expected 3 balls faced for Rohit S, got ${profA.stats.batting.balls}`);
  }
  if (profA.stats.batting.fours !== 1 || profA.stats.batting.sixes !== 1) {
    throw new Error(`FAILED: Fours/Sixes count mismatch`);
  }
  if (profA.stats.batting.highestScore !== '11*') {
    throw new Error(`FAILED: Expected highest score '11*', got ${profA.stats.batting.highestScore}`);
  }
  console.log('✅ Player A stats strictly match actual played balls and scores!');

  console.log('\n--- Step 5: Verify Career Stats for Player B (Bumrah J) ---');
  const profB = await apiGet(`/api/profile/${testPhoneB}`);
  console.log('Player B Bowling -> Overs:', profB.stats.bowling.overs, 'Wickets:', profB.stats.bowling.wickets, 'RunsConceded:', profB.stats.bowling.runsConceded, 'Economy:', profB.stats.bowling.economy);

  if (profB.stats.bowling.wickets !== 1) {
    throw new Error(`FAILED: Expected 1 wicket for Bumrah J, got ${profB.stats.bowling.wickets}`);
  }
  if (profB.stats.bowling.runsConceded !== 13) {
    throw new Error(`FAILED: Expected 13 runs conceded, got ${profB.stats.bowling.runsConceded}`);
  }
  if (profB.stats.bowling.overs !== '1.0') {
    throw new Error(`FAILED: Expected 1.0 overs, got ${profB.stats.bowling.overs}`);
  }
  console.log('✅ Player B bowling stats strictly match actual overs and wickets!');

  console.log('\n--- Step 6: Verify Unrelated Player C remains untouched with 0 ---');
  const profC = await apiGet(`/api/profile/919876543210`);
  if (profC.stats.batting.runs !== 0 || profC.stats.bowling.wickets !== 0 || profC.player.totalMatches !== 0) {
    throw new Error('FAILED: Unrelated player stats were contaminated!');
  }
  console.log('✅ Unrelated player stats remain cleanly at 0!');

  sockA.disconnect();
  sockB.disconnect();
  console.log('\n🎉 ALL CAREER STATS ACCURACY TESTS PASSED PERFECTLY!');
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
