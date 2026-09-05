const io = require('socket.io-client');

async function testMatchSetupPlayerAddition() {
  console.log('🧪 Testing Match Setup Player Addition & Normalization...');

  const socket = io('http://localhost:3000', { transports: ['websocket'] });

  await new Promise((resolve) => socket.on('connect', resolve));
  console.log('✅ Socket connected');

  // Register user
  socket.emit('user:register', { phone: '919876543210', name: 'Captain Marvel' });

  // Create room
  const createPromise = new Promise((resolve) => {
    socket.on('room:created', (data) => resolve(data));
  });
  socket.emit('room:create', { matchName: 'Setup Player Test Derby', overs: 2 });
  const roomData = await createPromise;
  const roomCode = roomData.code;
  console.log('✅ Room created:', roomCode);

  // Test match:setup with string array players
  const updatePromise1 = new Promise((resolve) => {
    socket.once('state:update', (state) => resolve(state));
  });

  socket.emit('match:setup', {
    overs: 5,
    teams: {
      team1: { name: 'Team Alpha', players: ['Alpha 1', 'Alpha 2', 'Alpha 3'] },
      team2: { name: 'Team Bravo', players: ['Bravo 1', 'Bravo 2'] }
    }
  });

  const updatedState1 = await updatePromise1;
  console.log('Team 1 players after string setup:', updatedState1.match.teams.team1.players);
  if (updatedState1.match.teams.team1.players.some(p => typeof p !== 'string')) {
    throw new Error('Expected all player names to be strings!');
  }
  console.log('✅ String player setup sanitized properly into clean string arrays');

  // Test match:setup with legacy object array players (e.g., { name: 'Alpha 4', id: 'Alpha 4' })
  const updatePromise2 = new Promise((resolve) => {
    socket.once('state:update', (state) => resolve(state));
  });

  socket.emit('match:setup', {
    overs: 5,
    teams: {
      team1: { name: 'Team Alpha', players: [{ id: 'p1', name: 'Legacy Object Player 1' }, 'String Player 2'] },
      team2: { name: 'Team Bravo', players: [{ name: 'Legacy Object Player 2' }] }
    }
  });

  const updatedState2 = await updatePromise2;
  console.log('Team 1 players after legacy object setup:', updatedState2.match.teams.team1.players);
  if (updatedState2.match.teams.team1.players[0] !== 'Legacy Object Player 1' || typeof updatedState2.match.teams.team1.players[0] !== 'string') {
    throw new Error('Legacy object was not normalized to string name!');
  }
  console.log('✅ Legacy object player setup normalized properly into clean string names: ' + JSON.stringify(updatedState2.match.teams.team1.players));

  socket.disconnect();
  console.log('🎉 ALL MATCH SETUP PLAYER ADDITION TESTS PASSED!');
}

testMatchSetupPlayerAddition().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
