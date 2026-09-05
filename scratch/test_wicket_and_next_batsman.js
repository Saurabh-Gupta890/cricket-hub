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

async function testWicketAndNextBatsmanFlow() {
  console.log('🧪 Starting Wicket, Next Batsman & Single Batter Flow Tests...');

  const phone = '+919999900010';
  const otpRes = await postJson('/api/auth/request-otp', { phone });
  const verifyRes = await postJson('/api/auth/verify-otp', {
    phone,
    otp: otpRes.data.devOtp,
    name: 'Host Captain',
    role: 'All-Rounder'
  });
  const token = verifyRes.data.token;

  const socketHost = ioClient(BASE_URL, { reconnection: false });
  await new Promise(r => socketHost.on('connect', r));

  socketHost.emit('user:register', { token, phone });

  // ──────────────────────────────────────────────
  // TEST PART 1: Wicket -> Block Bowling -> Next Batsman Walks In
  // ──────────────────────────────────────────────
  const createPromise = new Promise(r => socketHost.on('room:created', r));
  socketHost.emit('room:create', { token, matchName: 'Wicket & Next Batsman Test', overs: 2 });
  const roomData = await createPromise;
  const roomId = roomData.code;
  console.log(`✅ Created match 1: ${roomId}`);

  const setupPromise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('match:setup', {
    overs: 2,
    teams: {
      team1: { name: 'Warriors', players: ['Striker A', 'NonStriker B', 'Bench C'] },
      team2: { name: 'Titans', players: ['Bowler 1', 'Bowler 2'] }
    }
  });
  await setupPromise;

  const tossPromise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('match:toss', { winner: 'team1', choice: 'bat' });
  await tossPromise;

  const setBatPromise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Striker A',
    nonStriker: 'NonStriker B',
    isSingleBatter: false
  });
  await setBatPromise;

  const setBowlPromise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Bowler 1'
  });
  await setBowlPromise;

  // Ball 1: 4 runs
  const ball1Promise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 4, wicket: false });
  await ball1Promise;

  // Ball 2: WICKET! (Striker A is OUT)
  const ball2Promise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 0, wicket: true, dismissal: 'bowled' });
  const state2 = await ball2Promise;
  const inn = state2.match.innings[0];

  if (inn.wickets !== 1) throw new Error('Expected 1 wicket!');
  if (!inn.awaitingNewBatsman) throw new Error('Expected awaitingNewBatsman to be true!');
  if (inn.currentBatsmen[0] !== null) throw new Error('Expected striker slot to be cleared (null)!');
  console.log(`✅ Striker A dismissed. awaitingNewBatsman=true, striker slot is null.`);

  // Attempt to bowl while awaiting next batsman — MUST BE REJECTED!
  let errorReceived = null;
  socketHost.once('score:error', (err) => { errorReceived = err; });
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 1, wicket: false });
  await new Promise(r => setTimeout(r, 400));

  if (!errorReceived) throw new Error('Expected score:error when bowling before selecting next batsman!');
  console.log(`✅ Bowling blocked while awaiting next batter: "${errorReceived.message}"`);

  // Now select Bench C as next batsman
  const nextBatPromise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:nextBatsman', {
    inningsIdx: 0,
    batsmanName: 'Bench C',
    isSingleBatter: false
  });
  const state3 = await nextBatPromise;
  const inn3 = state3.match.innings[0];

  if (inn3.awaitingNewBatsman) throw new Error('Expected awaitingNewBatsman to be false after selection!');
  if (inn3.currentBatsmen[0] === null || inn3.batsmen[inn3.currentBatsmen[0]].name !== 'Bench C') {
    throw new Error('Expected Bench C to be active striker!');
  }
  console.log(`✅ Next batter "Bench C" selected. awaitingNewBatsman=false. Active striker is Bench C.`);

  // Ball 3: 2 runs with Bench C
  const ball3Promise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 2, wicket: false });
  const state4 = await ball3Promise;
  console.log(`✅ Ball 3 scored: ${state4.match.innings[0].runs}/${state4.match.innings[0].wickets}`);

  // ──────────────────────────────────────────────
  // TEST PART 2: Single Batter Mode Activation after Wicket
  // ──────────────────────────────────────────────
  const createPromise2 = new Promise(r => socketHost.on('room:created', r));
  socketHost.emit('room:create', { token, matchName: 'Single Batter Mode Test', overs: 2 });
  const roomData2 = await createPromise2;
  const roomId2 = roomData2.code;
  console.log(`\n✅ Created match 2: ${roomId2}`);

  const setupPromise2 = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('match:setup', {
    overs: 2,
    teams: {
      team1: { name: 'Eagles', players: ['Player 1', 'Player 2', 'Player 3'] },
      team2: { name: 'Hawks', players: ['Bowler X'] }
    }
  });
  await setupPromise2;

  const tossPromise2 = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('match:toss', { winner: 'team1', choice: 'bat' });
  await tossPromise2;

  const setBatPromise2 = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Player 1',
    nonStriker: 'Player 2',
    isSingleBatter: false
  });
  await setBatPromise2;

  const setBowlPromise2 = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Bowler X'
  });
  await setBowlPromise2;

  // Ball 1: Player 1 out (Wicket!)
  const wicketPromise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 0, wicket: true, dismissal: 'caught' });
  const wState = await wicketPromise;
  console.log('✅ Player 1 OUT! Wicket recorded.');

  // Choose "Play with 1 Batter (Single Batter Mode)"
  const singlePromise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:nextBatsman', {
    inningsIdx: 0,
    isSingleBatter: true
  });
  const sState = await singlePromise;
  const sInn = sState.match.innings[0];

  if (!sInn.isSingleBatter) throw new Error('Expected isSingleBatter to be true!');
  if (sInn.currentBatsmen[0] === null || sInn.batsmen[sInn.currentBatsmen[0]].name !== 'Player 2') {
    throw new Error('Expected Player 2 to become solo striker!');
  }
  if (sInn.awaitingNewBatsman) throw new Error('Expected awaitingNewBatsman to be false in single batter mode!');
  console.log(`✅ Single Batter Mode active! Solo striker: ${sInn.batsmen[sInn.currentBatsmen[0]].name}`);

  // Ball with Single Batter: odd run should NOT rotate strike away
  const soloIdx = sInn.currentBatsmen[0];
  const ballOddPromise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 1, wicket: false });
  const oddState = await ballOddPromise;
  const oddInn = oddState.match.innings[0];

  if (oddInn.currentBatsmen[0] !== soloIdx) {
    throw new Error('Solo batter should retain strike on odd runs!');
  }
  console.log(`✅ Solo batter scored 1 run and retained strike as expected.`);

  // ──────────────────────────────────────────────
  // TEST PART 3: Starting Match directly in Single Batter Mode
  // ──────────────────────────────────────────────
  const createPromise3 = new Promise(r => socketHost.on('room:created', r));
  socketHost.emit('room:create', { token, matchName: 'Solo Opener Match', overs: 1 });
  const roomData3 = await createPromise3;
  console.log(`\n✅ Created match 3: ${roomData3.code}`);

  const setupPromise3 = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('match:setup', {
    overs: 1,
    teams: {
      team1: { name: 'Solo Tigers', players: ['Lone Tiger'] },
      team2: { name: 'Panthers', players: ['Bowler P'] }
    }
  });
  await setupPromise3;

  const tossPromise3 = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('match:toss', { winner: 'team1', choice: 'bat' });
  await tossPromise3;

  const setBatPromise3 = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:setBatsmen', {
    inningsIdx: 0,
    striker: 'Lone Tiger',
    isSingleBatter: true
  });
  await setBatPromise3;

  const setBowlPromise3 = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:setBowler', {
    inningsIdx: 0,
    bowlerName: 'Bowler P'
  });
  await setBowlPromise3;

  const solo6Promise = new Promise(r => socketHost.once('state:update', r));
  socketHost.emit('score:ball', { inningsIdx: 0, runs: 6, wicket: false });
  const solo6State = await solo6Promise;
  console.log(`✅ Solo match scored six! Score: ${solo6State.match.innings[0].runs}/0`);

  socketHost.disconnect();
  console.log('\n🎉 ALL WICKET, NEXT BATSMAN & SINGLE BATTER TESTS PASSED 100%!');
}

testWicketAndNextBatsmanFlow().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
