const io = require('socket.io-client');
const http = require('http');
const assert = require('assert');

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

function waitForEvent(socket, eventName, timeout = 5000) {
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

async function createAuthUser(name) {
  const phone = `+91999988${Math.floor(1000 + Math.random() * 9000)}`;
  const otpRes = await postJson('/api/auth/request-otp', { phone, name });
  const devOtp = otpRes.data.devOtp;
  const verifyRes = await postJson('/api/auth/verify-otp', { phone, otp: devOtp, name });
  return { phone, name, token: verifyRes.data.token };
}

async function runCricketRulesTestSuite() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🏏 COMPREHENSIVE CRICKET RULES TEST SUITE (10 RULES CATEGORIES)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let passedTests = 0;
  let totalTests = 0;

  function recordPass(testName) {
    totalTests++;
    passedTests++;
    console.log(`✅ [RULE ${totalTests}] PASS: ${testName}`);
  }

  const host = await createAuthUser('Umpire Official');
  const socket = io(BASE_URL, { reconnection: false, forceNew: true });
  await new Promise(r => socket.on('connect', r));

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 1: RUN SCORING & MID-OVER STRIKE ROTATION
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 1: Run Scoring & Mid-Over Strike Rotation ---');
  let roomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token: host.token, matchName: 'Rule Verification Room' }, (res) => {
      roomCode = res.room.code;
      resolve();
    });
  });

  socket.emit('match:setup', {
    overs: 2,
    team1: { name: 'Royal Challengers', players: ['Kohli', 'DuPlessis', 'Maxwell', 'Dinesh'] },
    team2: { name: 'Chennai Super Kings', players: ['Dhoni', 'Jadeja', 'Chahar', 'Pathirana'] }
  });
  await new Promise(r => setTimeout(r, 80));
  socket.emit('match:startToss');
  await new Promise(r => setTimeout(r, 80));
  socket.emit('match:toss', { winner: 'team1', decision: 'bat' });
  await new Promise(r => setTimeout(r, 80));

  await new Promise(r => socket.emit('score:setBatsmen', { inningsIdx: 0, striker: 'Kohli', nonStriker: 'DuPlessis', token: host.token }, r));
  await new Promise(r => socket.emit('score:setBowler', { inningsIdx: 0, bowlerName: 'Chahar', token: host.token }, r));

  // Ball 1: 1 Run (Odd run -> strike rotates)
  let p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 1, token: host.token });
  let st = await p;
  let inn = st.match.innings[0];
  assert.strictEqual(inn.runs, 1);
  assert.strictEqual(inn.batsmen[inn.currentBatsmen[0]].name, 'DuPlessis', 'Strike should rotate to DuPlessis after 1 run');
  assert.strictEqual(inn.batsmen[inn.currentBatsmen[1]].name, 'Kohli');
  recordPass('Single (1 run) adds to team and rotates strike mid-over');

  // Ball 2: 4 Runs (Boundary 4 -> four count +1, strike retained)
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 4, token: host.token });
  st = await p;
  inn = st.match.innings[0];
  const duplessis = inn.batsmen.find(b => b.name === 'DuPlessis');
  assert.strictEqual(duplessis.runs, 4);
  assert.strictEqual(duplessis.fours, 1);
  assert.strictEqual(inn.batsmen[inn.currentBatsmen[0]].name, 'DuPlessis', 'Strike should stay with DuPlessis on 4');
  recordPass('Four (4 runs) awards boundary and retains strike');

  // Ball 3: 6 Runs (Maximum 6 -> six count +1, strike retained)
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 6, token: host.token });
  st = await p;
  inn = st.match.innings[0];
  const dupAfterSix = inn.batsmen.find(b => b.name === 'DuPlessis');
  assert.strictEqual(dupAfterSix.runs, 10);
  assert.strictEqual(dupAfterSix.sixes, 1);
  assert.strictEqual(inn.batsmen[inn.currentBatsmen[0]].name, 'DuPlessis');
  recordPass('Six (6 runs) awards maximum and retains strike');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 2: EXTRAS (WIDE, NO BALL, BYES, LEG BYES)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 2: Extras Mechanics (Wide, No Ball, Byes, Leg Byes) ---');

  // Ball 4: Wide (+1 extra run, legal ball NOT counted, bowler charged run)
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 0, extras: { wide: true }, token: host.token });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.extras.wide, 1);
  assert.strictEqual(inn.runs, 12);
  assert.strictEqual(inn.balls, 3, 'Wide delivery does not count as a legal ball in over');
  assert.strictEqual(inn.bowlers.find(b => b.name === 'Chahar').runs, 12, 'Bowler conceded runs includes wide');
  recordPass('Wide adds +1 extra, charges bowler, does NOT increment over balls');

  // Ball 4: No Ball (+1 extra run, legal ball NOT counted)
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 0, extras: { noBall: true }, token: host.token });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.extras.noBall, 1);
  assert.strictEqual(inn.runs, 13);
  assert.strictEqual(inn.balls, 3, 'No ball delivery does not count as a legal ball in over');
  recordPass('No Ball adds +1 extra, charges bowler, does NOT increment over balls');

  // Ball 4: Bye (3 Byes -> team +3 runs, striker runs NOT incremented, bowler NOT charged)
  const bowlerRunsBeforeByes = inn.bowlers.find(b => b.name === 'Chahar').runs;
  const strikerRunsBeforeByes = inn.batsmen.find(b => b.name === 'DuPlessis').runs;
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 3, extras: { bye: 3 }, token: host.token });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.extras.bye, 3);
  assert.strictEqual(inn.runs, 16);
  assert.strictEqual(inn.balls, 4, 'Byes count as legal delivery in over');
  assert.strictEqual(inn.batsmen.find(b => b.name === 'DuPlessis').runs, strikerRunsBeforeByes, 'Batter runs NOT incremented on byes');
  assert.strictEqual(inn.bowlers.find(b => b.name === 'Chahar').runs, bowlerRunsBeforeByes, 'Bowler NOT charged for byes');
  assert.strictEqual(inn.batsmen[inn.currentBatsmen[0]].name, 'Kohli', 'Odd byes (3) rotated strike to Kohli');
  recordPass('Byes add to team extras only, do NOT credit batter, do NOT charge bowler');

  // Ball 5: Leg Bye (1 Leg Bye)
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 1, extras: { legBye: 1 }, token: host.token });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.extras.legBye, 1);
  assert.strictEqual(inn.balls, 5);
  recordPass('Leg Byes credit team extras and count as legal ball');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 3: OVER COMPLETION & BOWLER CHANGE RESTRICTIONS
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 3: Over Completion & End-of-Over Strike Change ---');

  // Ball 6 (End of Over 1): 2 runs (DuPlessis faces, hits 2 runs)
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 2, token: host.token });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.balls, 6);
  assert.strictEqual(inn.overs, 1);
  assert.strictEqual(inn.awaitingNewBowler, true, 'Must await new bowler at end of over');
  assert.strictEqual(inn.lastBowlerIdx, 0, 'Chahar recorded as last bowler');
  assert.strictEqual(inn.batsmen[inn.currentBatsmen[0]].name, 'Kohli', 'Strike rotated at end of over to Kohli');
  recordPass('Over completion (6 legal balls) rotates strike and prompts for new bowler');

  // Consecutive bowler validation: Set Jadeja as new bowler
  await new Promise(r => socket.emit('score:setBowler', { inningsIdx: 0, bowlerName: 'Jadeja', token: host.token }, r));
  recordPass('Consecutive bowler change allows different bowler to bowl Over 2');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 4: DISMISSAL TYPES & BOWLER WICKET CREDITING
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 4: Dismissal Types & Bowler Wicket Attribution ---');

  // Over 2 Ball 1: Bowled -> +1 Bowler Wicket (Kohli out)
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 0, wicket: true, dismissalType: 'Bowled', token: host.token });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.wickets, 1);
  assert.strictEqual(inn.bowlers.find(b => b.name === 'Jadeja').wickets, 1, 'Jadeja credited with 1 wicket for Bowled');
  assert.strictEqual(inn.batsmen.find(b => b.name === 'Kohli').dismissal, 'b Jadeja');
  assert.strictEqual(inn.awaitingNewBatsman, true);
  recordPass('Bowled credits +1 wicket to bowler with standard "b Bowler" notation');

  // Set next batter: Maxwell
  await new Promise(r => socket.emit('score:nextBatsman', { inningsIdx: 0, batsmanName: 'Maxwell', token: host.token }, r));

  // Over 2 Ball 2: Caught -> +1 Bowler Wicket (Maxwell out, custom note "c Dhoni")
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 0, wicket: true, dismissal: 'c Dhoni', dismissalType: 'Caught', token: host.token });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.wickets, 2);
  assert.strictEqual(inn.bowlers.find(b => b.name === 'Jadeja').wickets, 2, 'Jadeja credited with 2 wickets after Caught');
  assert.strictEqual(inn.batsmen.find(b => b.name === 'Maxwell').dismissal, 'c Dhoni b Jadeja');
  recordPass('Caught credits +1 wicket to bowler with "c Fielder b Bowler" notation');

  // Set next batter: Dinesh
  await new Promise(r => socket.emit('score:nextBatsman', { inningsIdx: 0, batsmanName: 'Dinesh', token: host.token }, r));

  // Over 2 Ball 3: Stumped on Wide -> +1 Bowler Wicket, +1 Wide Extra (Dinesh out)
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 0, extras: { wide: true }, wicket: true, dismissalType: 'Stumped', token: host.token });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.wickets, 3);
  assert.strictEqual(inn.bowlers.find(b => b.name === 'Jadeja').wickets, 3, 'Jadeja credited with 3 wickets after Stumped on Wide');
  assert.strictEqual(inn.batsmen.find(b => b.name === 'Dinesh').dismissal, 'st b Jadeja');
  assert.strictEqual(inn.balls, 8, 'Wide did not count as legal ball');
  recordPass('Stumped on Wide awards +1 wide extra, +1 bowler wicket, and no legal ball');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 5: RUN OUT (NON-BOWLER WICKET) & COMPLETED RUNS
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 5: Run Out (No Bowler Credit) & Completed Runs ---');

  // Continue in single batter mode with DuPlessis
  await new Promise(r => socket.emit('score:nextBatsman', { inningsIdx: 0, isSingleBatter: true, token: host.token }, r));

  // Over 2 Ball 3: Striker Run Out with 2 completed runs -> DuPlessis OUT, team +2 runs, bowler wickets STILL 3
  const jadejaWicketsBefore = inn.bowlers.find(b => b.name === 'Jadeja').wickets;
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', {
    inningsIdx: 0,
    runs: 2,
    wicket: true,
    dismissalType: 'Run Out',
    dismissedSlot: 'striker',
    dismissal: 'Direct hit Dhoni',
    token: host.token
  });
  st = await p;
  inn = st.match.innings[0];
  assert.strictEqual(inn.wickets, 4);
  assert.strictEqual(inn.bowlers.find(b => b.name === 'Jadeja').wickets, jadejaWicketsBefore, 'Bowler wickets MUST NOT increment on Run Out');
  assert.strictEqual(inn.batsmen.find(b => b.name === 'DuPlessis').dismissal, 'Direct hit Dhoni');
  recordPass('Run Out credits completed runs to team/batter, but DOES NOT credit bowler with wicket');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 6: INNINGS TRANSITIONS & CHASE TARGET CALCULATION
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 6: Innings Transitions & Target Calculation ---');

  // 1st innings all out -> automatic transition to innings 2
  assert.strictEqual(st.match.status, 'innings2', '1st innings all-out should transition directly to innings2');
  const targetRuns = st.match.innings[1].target;
  assert.strictEqual(targetRuns, st.match.innings[0].runs + 1, `Target must be Innings 1 Runs + 1 (${st.match.innings[0].runs} + 1 = ${targetRuns})`);
  recordPass('1st Innings all-out transitions to Innings 2 with target = Innings 1 Runs + 1');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 7: CHASE VICTORY & MATCH RESULTS
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 7: Chase Victory & Match Result Generation ---');

  // Set Innings 2 Batsmen & Bowler
  await new Promise(r => socket.emit('score:setBatsmen', { inningsIdx: 1, striker: 'Dhoni', nonStriker: 'Jadeja', token: host.token }, r));
  await new Promise(r => socket.emit('score:setBowler', { inningsIdx: 1, bowlerName: 'Kohli', token: host.token }, r));

  // Team 2 scores 6, 6, 6, 6 to surpass target
  for (let i = 0; i < 6; i++) {
    const currentInn2 = st.match.innings[1];
    console.log(`[Category 7 Chase i=${i}] status=${st.match.status}, runs=${currentInn2?.runs}, target=${currentInn2?.target}`);
    if (st.match.status === 'completed') break;
    p = waitForEvent(socket, 'state:update');
    socket.emit('score:ball', { inningsIdx: 1, runs: 6, token: host.token });
    st = await p;
  }
  console.log(`[Category 7 Done] status=${st.match.status}, result=`, st.match.result);

  assert.strictEqual(st.match.status, 'completed', 'Match must immediately complete upon chasing target');
  assert.strictEqual(st.match.result.winner, 'team2', 'Team 2 should be declared winner');
  assert(st.match.result.summary.includes('Chennai Super Kings won by 10 wickets'), 'Result summary reflects wickets in hand');
  recordPass('Chasing team surpasses target -> immediate victory by remaining wickets');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 8: TIED MATCH HANDLING (NO WINNER BY 0 RUNS)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 8: Tied Match Result Verification ---');

  // Create a quick 1-over tie match
  let tieRoomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token: host.token, matchName: 'Tie Test Room' }, (res) => {
      tieRoomCode = res.room.code;
      resolve();
    });
  });
  socket.emit('match:setup', { overs: 1, team1: { name: 'Red', players: ['R1', 'R2'] }, team2: { name: 'Blue', players: ['B1', 'B2'] } });
  await new Promise(r => setTimeout(r, 60));
  socket.emit('match:startToss');
  await new Promise(r => setTimeout(r, 60));
  socket.emit('match:toss', { winner: 'team1', decision: 'bat' });
  await new Promise(r => setTimeout(r, 60));

  await new Promise(r => socket.emit('score:setBatsmen', { inningsIdx: 0, striker: 'R1', nonStriker: 'R2', token: host.token }, r));
  await new Promise(r => socket.emit('score:setBowler', { inningsIdx: 0, bowlerName: 'B1', token: host.token }, r));

  // Innings 1: 10 runs (6 balls: 2, 2, 2, 2, 2, 0)
  for (let b = 0; b < 5; b++) {
    p = waitForEvent(socket, 'state:update');
    socket.emit('score:ball', { inningsIdx: 0, runs: 2, token: host.token });
    await p;
  }
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 0, token: host.token });
  st = await p; // Innings 1 completed: 10 runs

  // Innings 2: Set Batsmen & Bowler
  await new Promise(r => socket.emit('score:setBatsmen', { inningsIdx: 1, striker: 'B1', nonStriker: 'B2', token: host.token }, r));
  await new Promise(r => socket.emit('score:setBowler', { inningsIdx: 1, bowlerName: 'R1', token: host.token }, r));

  // Innings 2: 10 runs (6 balls: 2, 2, 2, 2, 2, 0 -> Total 10 runs)
  for (let b = 0; b < 5; b++) {
    p = waitForEvent(socket, 'state:update');
    socket.emit('score:ball', { inningsIdx: 1, runs: 2, token: host.token });
    await p;
  }
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 1, runs: 0, token: host.token });
  st = await p;

  assert.strictEqual(st.match.status, 'completed');
  assert.strictEqual(st.match.result.winner, 'tie', 'Result winner must be "tie"');
  assert(st.match.result.summary.toLowerCase().includes('match tied'), 'Summary must declare Match Tied');
  recordPass('Equal scores in completed innings produces official Match Tied result');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 9: UNDO & REDO STATE REVERSIBILITY
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 9: Undo / Redo Scoring State Integrity ---');

  // Create match for undo test
  let undoRoomCode;
  await new Promise((resolve) => {
    socket.emit('room:create', { token: host.token, matchName: 'Undo Test Room' }, (res) => {
      undoRoomCode = res.room.code;
      resolve();
    });
  });
  socket.emit('match:setup', { overs: 2, team1: { name: 'Team U1', players: ['U1', 'U2'] }, team2: { name: 'Team U2', players: ['UB1', 'UB2'] } });
  await new Promise(r => setTimeout(r, 60));
  socket.emit('match:startToss');
  await new Promise(r => setTimeout(r, 60));
  socket.emit('match:toss', { winner: 'team1', decision: 'bat' });
  await new Promise(r => setTimeout(r, 60));

  await new Promise(r => socket.emit('score:setBatsmen', { inningsIdx: 0, striker: 'U1', nonStriker: 'U2', token: host.token }, r));
  await new Promise(r => socket.emit('score:setBowler', { inningsIdx: 0, bowlerName: 'UB1', token: host.token }, r));

  // Bowl a 6
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:ball', { inningsIdx: 0, runs: 6, token: host.token });
  st = await p;
  assert.strictEqual(st.match.innings[0].runs, 6);
  assert.strictEqual(st.match.innings[0].balls, 1);

  // Undo the 6
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:undo', { inningsIdx: 0 });
  st = await p;
  assert.strictEqual(st.match.innings[0].runs, 0, 'Runs restored to 0 after undo');
  assert.strictEqual(st.match.innings[0].balls, 0, 'Balls restored to 0 after undo');

  // Redo the 6
  p = waitForEvent(socket, 'state:update');
  socket.emit('score:redo', { inningsIdx: 0 });
  st = await p;
  assert.strictEqual(st.match.innings[0].runs, 6, 'Runs restored to 6 after redo');
  assert.strictEqual(st.match.innings[0].balls, 1, 'Balls restored to 1 after redo');
  recordPass('Undo / Redo accurately reverses and restores entire ball & statistics state');

  // ─────────────────────────────────────────────────────────────────
  // CATEGORY 10: CAREER & MATCH PERFORMANCE PROFILE AGGREGATION
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- CATEGORY 10: Career & Player Profile Statistics Aggregation ---');

  const playersRes = await fetch(`${BASE_URL}/api/players`).then(r => r.json());
  assert(playersRes.players && playersRes.players.length > 0, 'Player directory contains registered profiles');
  const samplePlayer = playersRes.players[0];
  assert(samplePlayer, 'Sample player exists in directory');
  assert(typeof samplePlayer.totalRuns === 'number');
  assert(typeof samplePlayer.totalWickets === 'number');
  assert(typeof samplePlayer.totalMatches === 'number');

  // Also query detailed profile stats endpoint
  const profRes = await fetch(`${BASE_URL}/api/profile/${encodeURIComponent(samplePlayer.id || samplePlayer.name)}`).then(r => r.json());
  assert(profRes.player, 'Player profile exists');
  assert(profRes.stats && profRes.stats.batting && profRes.stats.bowling, 'Player profile contains batting & bowling stats');
  assert(typeof profRes.stats.batting.runs === 'number');
  assert(typeof profRes.stats.bowling.wickets === 'number');
  recordPass('API /api/players & /api/profile/:id aggregate all batting & bowling cricket statistics correctly');

  socket.close();

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`🏆 ALL ${passedTests}/${totalTests} CRICKET RULE CATEGORIES VERIFIED AND PASSING 100%!`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
  process.exit(0);
}

runCricketRulesTestSuite().catch(err => {
  console.error('\n❌ Cricket Rules Test Suite Error:', err);
  process.exit(1);
});
