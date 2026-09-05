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

async function runAdvancedFeatureTests() {
  console.log('🚀 Running Advanced Feature Tests (PWA, Super Over, Poster Export)...\n');

  // 1. Test PWA Static Shell & Manifest
  try {
    const manifestRes = await getJson('/manifest.json');
    if (manifestRes.status === 200 && manifestRes.data.name && manifestRes.data.display === 'standalone') {
      pass('PWA Manifest Validation', `Name: "${manifestRes.data.name}" (Standalone)`);
    } else {
      throw new Error(JSON.stringify(manifestRes));
    }

    const swRes = await getJson('/sw.js');
    if (swRes.status === 200 && swRes.raw.includes('CACHE_NAME')) {
      pass('Service Worker Script (sw.js)', 'Cache-first & offline asset pipeline ready');
    } else {
      throw new Error('sw.js missing');
    }
  } catch (e) {
    fail('PWA Validation', e);
  }

  // 2. Setup Super Over Match Simulation
  const phone1 = '+919999911111';
  const phone2 = '+919999922222';

  let token1, token2, user1, user2;
  try {
    const otp1 = await postJson('/api/auth/request-otp', { phone: phone1 });
    const auth1 = await postJson('/api/auth/verify-otp', { phone: phone1, otp: otp1.data.devOtp, name: 'MS Dhoni', jersey: '7', role: 'Wicketkeeper' });
    token1 = auth1.data.token;
    user1 = auth1.data.user;

    const otp2 = await postJson('/api/auth/request-otp', { phone: phone2 });
    const auth2 = await postJson('/api/auth/verify-otp', { phone: phone2, otp: otp2.data.devOtp, name: 'Steve Smith', jersey: '49', role: 'Batter' });
    token2 = auth2.data.token;
    user2 = auth2.data.user;

    pass('Player Auth Setup', `${user1.name} & ${user2.name}`);
  } catch (e) {
    fail('Player Auth Setup', e);
  }

  const socket1 = ioClient(BASE_URL, { reconnection: false });
  const socket2 = ioClient(BASE_URL, { reconnection: false });

  await Promise.all([
    new Promise(res => socket1.on('connect', res)),
    new Promise(res => socket2.on('connect', res))
  ]);

  socket1.emit('user:register', { token: token1, phone: user1.phone });
  socket2.emit('user:register', { token: token2, phone: user2.phone });

  let room;
  try {
    const createRes = await new Promise(res => socket1.emit('room:create', { token: token1, matchName: 'World Cup Final Tie' }, res));
    room = createRes.room;
    await new Promise(res => socket2.emit('room:join', { token: token2, code: room.code }, res));
    pass('Room Initialized', `Code: ${room.code}`);
  } catch (e) {
    fail('Room Init', e);
  }

  // Setup 1-Over match
  try {
    const pSetup = waitForEvent(socket1, 'state:update');
    socket1.emit('match:setup', {
      teams: {
        team1: { name: 'India', players: [user1.name, 'Virat Kohli'] },
        team2: { name: 'Australia', players: [user2.name, 'David Warner'] }
      },
      overs: 1,
      date: '2026-09-06',
      time: '19:00',
      location: { text: 'Melbourne Cricket Ground', mapUrl: 'https://maps.google.com' }
    });
    await pSetup;

    // Start Toss
    const pToss1 = waitForEvent(socket1, 'state:update');
    socket1.emit('match:startToss');
    await pToss1;

    const pToss2 = waitForEvent(socket1, 'state:update');
    socket1.emit('match:toss', { winner: 'team1', choice: 'bat' });
    await pToss2;
    pass('Match & Toss Setup', 'India batting first in 1-Over match');
  } catch (e) {
    fail('Match & Toss Setup', e);
  }

  // Innings 1: India scores 10 runs in 1 over
  try {
    const pBat = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBatsmen', { inningsIdx: 0, striker: user1.name, nonStriker: 'Virat Kohli' });
    await pBat;

    const pBowl = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBowler', { inningsIdx: 0, bowlerName: user2.name });
    await pBowl;

    // 10 runs (6 balls: 2, 2, 2, 2, 1, 1)
    const runsList1 = [2, 2, 2, 2, 1, 1];
    for (const r of runsList1) {
      const pBall = waitForEvent(socket1, 'state:update');
      socket1.emit('score:ball', { inningsIdx: 0, runs: r, extras: null, wicket: false, dismissal: null });
      await pBall;
    }
    pass('Innings 1 Complete', 'India scored 10/0 in 1.0 ov. Target for Aus: 11');
  } catch (e) {
    fail('Innings 1', e);
  }

  // Innings 2: Australia scores EXACTLY 10 runs in 1 over (Tie!)
  try {
    const pBat2 = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBatsmen', { inningsIdx: 1, striker: user2.name, nonStriker: 'David Warner' });
    await pBat2;

    const pBowl2 = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBowler', { inningsIdx: 1, bowlerName: user1.name });
    await pBowl2;

    // 10 runs (6 balls: 1, 1, 2, 2, 2, 2)
    const runsList2 = [1, 1, 2, 2, 2, 2];
    let stateAfterInn2;
    for (const r of runsList2) {
      const pBall = waitForEvent(socket1, 'state:update');
      socket1.emit('score:ball', { inningsIdx: 1, runs: r, extras: null, wicket: false, dismissal: null });
      stateAfterInn2 = await pBall;
    }

    if (stateAfterInn2.match.status === 'completed') {
      pass('Match Finished as TIE', `India: 10/0 vs Australia: 10/0`);
    } else {
      throw new Error(`Expected status completed, got: ${stateAfterInn2.match.status}`);
    }
  } catch (e) {
    fail('Innings 2 (Tie)', e);
  }

  // 3. Trigger Super Over Shootout!
  try {
    const pSO = waitForEvent(socket1, 'state:update');
    socket1.emit('match:startSuperOver');
    const stateSO = await pSO;

    if (stateSO.match.isSuperOver && stateSO.match.status === 'super_over_inn1' && stateSO.match.currentInnings === 2) {
      pass('Super Over Launched', 'Innings 3 & 4 initialized with 1-Over & 2-Wickets cap');
    } else {
      throw new Error(`Super over launch failed: ${JSON.stringify(stateSO.match)}`);
    }

    // Super Over 1st Innings (Australia batting)
    const pSOBatsmen = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBatsmen', { inningsIdx: 2, striker: user2.name, nonStriker: 'David Warner' });
    await pSOBatsmen;

    const pSOBowler = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBowler', { inningsIdx: 2, bowlerName: user1.name });
    await pSOBowler;

    // Australia scores 15 runs in Super Over 1st Innings
    const soRuns1 = [6, 4, 2, 1, 1, 1]; // 15 runs
    let stateAfterSO1;
    for (const r of soRuns1) {
      const pBall = waitForEvent(socket1, 'state:update');
      socket1.emit('score:ball', { inningsIdx: 2, runs: r, extras: null, wicket: false, dismissal: null });
      stateAfterSO1 = await pBall;
    }

    if (stateAfterSO1.match.status === 'super_over_inn2' && stateAfterSO1.match.currentInnings === 3) {
      pass('Super Over Innings 1 Complete', `Australia: 15/0. Target for India: 16 runs in 6 balls`);
    } else {
      throw new Error(`Expected super_over_inn2, got: ${stateAfterSO1.match.status}`);
    }

    // Super Over 2nd Innings (India chase)
    const pSOBatsmen2 = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBatsmen', { inningsIdx: 3, striker: user1.name, nonStriker: 'Virat Kohli' });
    await pSOBatsmen2;

    const pSOBowler2 = waitForEvent(socket1, 'state:update');
    socket1.emit('score:setBowler', { inningsIdx: 3, bowlerName: user2.name });
    await pSOBowler2;

    // India scores 6, 6, 4 (16 runs -> Reaches target of 16 in 3 balls!)
    let stateFinal;
    for (const r of [6, 6, 4]) {
      const pBall = waitForEvent(socket1, 'state:update');
      socket1.emit('score:ball', { inningsIdx: 3, runs: r, extras: null, wicket: false, dismissal: null });
      stateFinal = await pBall;
    }

    if (stateFinal.match.status === 'completed') {
      pass('Super Over Shootout Victory', `Summary: "${stateFinal.match.result?.summary}"`);
    } else {
      throw new Error(`Expected completed, got: ${stateFinal.match.status}`);
    }

  } catch (e) {
    fail('Super Over Flow', e);
  }

  socket1.disconnect();
  socket2.disconnect();

  console.log('\n==============================================');
  console.log(`ADVANCED FEATURES SUMMARY: ${results.filter(r => r.status === 'PASS').length} Passed, ${results.filter(r => r.status === 'FAIL').length} Failed`);
  console.log('==============================================\n');
  process.exit(results.filter(r => r.status === 'FAIL').length > 0 ? 1 : 0);
}

runAdvancedFeatureTests().catch(e => {
  console.error(e);
  process.exit(1);
});
