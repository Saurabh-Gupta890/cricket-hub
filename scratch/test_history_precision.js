const io = require('socket.io-client');
const http = require('http');

function apiGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
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
  console.log('🧪 Testing Match History Precision & Lifecycle...');

  // 1. Initial match history check
  const initHistory = await apiGet('/api/history');
  const baselineCount = initHistory.matches.length;
  console.log('Baseline Match History count:', baselineCount);

  // 2. Create a planning room
  const randSuffix = Date.now().toString().slice(-6);
  const hostPhone = `91982${randSuffix}1`;
  const playerPhone = `91982${randSuffix}2`;

  const otpRes1 = await requestOtp(hostPhone, 'Virat K');
  const user1 = await verifyOtp(hostPhone, otpRes1.devOtp);

  const otpRes2 = await requestOtp(playerPhone, 'Hardik P');
  const user2 = await verifyOtp(playerPhone, otpRes2.devOtp);

  const sock1 = io('http://localhost:3000', { transports: ['websocket'] });
  const sock2 = io('http://localhost:3000', { transports: ['websocket'] });

  await new Promise(r => sock1.on('connect', r));
  await new Promise(r => sock2.on('connect', r));

  sock1.emit('user:register', { token: user1.token });
  sock2.emit('user:register', { token: user2.token });

  const roomRes = await new Promise(resolve => {
    sock1.emit('room:create', { token: user1.token, matchName: 'Championship Derby' }, resolve);
  });
  const roomCode = roomRes.room ? roomRes.room.code : roomRes.code;
  console.log('Created Planning Room:', roomCode);

  // 3. Verify planning room does NOT show in /api/history
  const historyDuringPlanning = await apiGet('/api/history');
  if (historyDuringPlanning.matches.length !== baselineCount) {
    throw new Error('FAILED: Planning room incorrectly appeared in Match History before being played!');
  }
  console.log('✅ Planning room correctly excluded from Match History');

  // 4. Start match and score balls
  const team1 = { name: 'Royal Challengers', players: [{ id: hostPhone, name: 'Virat K', phone: hostPhone }] };
  const team2 = { name: 'Mumbai Kings', players: [{ id: playerPhone, name: 'Hardik P', phone: playerPhone }] };

  sock1.emit('planning:setupMatch', {
    team1,
    team2,
    overs: 1,
    battingFirst: 'team1',
    toss: { winner: 'team1', choice: 'bat' }
  });
  await new Promise(r => setTimeout(r, 500));
  sock1.emit('match:start');
  await new Promise(r => setTimeout(r, 500));

  sock1.emit('score:setBatsmen', { inningsIdx: 0, striker: 'Virat K', nonStriker: 'Player 2' });
  sock1.emit('score:setBowler', { inningsIdx: 0, bowlerName: 'Hardik P' });
  await new Promise(r => setTimeout(r, 500));

  sock1.emit('score:ball', { inningsIdx: 0, runs: 6, extras: null, wicket: false });
  await new Promise(r => setTimeout(r, 200));
  sock1.emit('score:ball', { inningsIdx: 0, runs: 4, extras: null, wicket: false });
  await new Promise(r => setTimeout(r, 500));

  // 5. Verify match now appears in history with exact score (10/0)
  const historyDuringLive = await apiGet('/api/history');
  console.log('History count during live match:', historyDuringLive.matches.length);
  if (historyDuringLive.matches.length !== baselineCount + 1) {
    throw new Error(`FAILED: Expected ${baselineCount + 1} matches in history, found ${historyDuringLive.matches.length}`);
  }
  const matchRec = historyDuringLive.matches.find(m => m.code === roomCode);
  if (!matchRec) {
    throw new Error(`FAILED: Could not find match ${roomCode} in history`);
  }
  console.log('Match in History -> Name:', matchRec.matchName, 'Code:', matchRec.code, 'Score Inn 1:', matchRec.inningsSummary[0].runs, 'Runs in', matchRec.inningsSummary[0].balls, 'balls');
  
  if (matchRec.inningsSummary[0].runs !== 10 || matchRec.inningsSummary[0].balls !== 2) {
    throw new Error('FAILED: History scorecard did not match actual played balls!');
  }
  console.log('✅ Match in History accurately reflects genuine played scorecard!');

  sock1.disconnect();
  sock2.disconnect();
  console.log('\n🎉 MATCH HISTORY PRECISION TEST PASSED!');
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
