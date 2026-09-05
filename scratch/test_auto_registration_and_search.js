const BASE_URL = 'http://localhost:3000';

async function postJSON(endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function getJSON(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function testAutoRegistrationAndSearch() {
  console.log('🧪 Starting Auto-Registration & Player Search Verification...');

  // 1. Create a Captain
  const captainPhone = '9888000111';
  const captainName = 'Rohit Sharma';

  const otpRes = await postJSON('/api/auth/request-otp', { phone: captainPhone, name: captainName, mode: 'signup' });
  const authRes = await postJSON('/api/auth/verify-otp', {
    phone: captainPhone,
    otp: otpRes.devOtp,
    name: captainName
  });
  console.log('✅ Captain logged in:', authRes.user.name);

  // 2. Create a Squad
  const grpRes = await postJSON('/api/groups/create', {
    name: 'India Champions',
    creatorPhone: captainPhone,
    creatorName: captainName
  });
  const group = grpRes.group;
  console.log('✅ Created squad:', group.name);

  // 3. Add a fresh teammate (e.g. Jasprit Bumrah) who never signed up before
  const newPlayerPhone = '9888000222';
  const newPlayerName = 'Jasprit Bumrah';

  const addRes = await postJSON(`/api/groups/${group.id}/add-member`, {
    name: newPlayerName,
    phone: newPlayerPhone,
    role: 'Bowler'
  });
  console.log('✅ Added Jasprit Bumrah to squad:', addRes.group.members.length, 'members');

  // 4. Verify Jasprit Bumrah is now auto-registered on the app and searchable in `/api/players`!
  const playersRes = await getJSON('/api/players');
  const foundInDirectory = (playersRes.players || []).find(p => p.name === 'Jasprit Bumrah');
  if (!foundInDirectory) {
    throw new Error('Jasprit Bumrah should be registered and visible in /api/players directory!');
  }
  console.log('✅ Jasprit Bumrah successfully auto-registered in app directory:', foundInDirectory);

  // 5. Verify Jasprit Bumrah profile endpoint
  const profRes = await getJSON(`/api/profile/${newPlayerPhone}`);
  const playerName = profRes.player?.name || profRes.user?.name;
  if (playerName !== 'Jasprit Bumrah') {
    throw new Error(`Profile endpoint failed for newly added player, got: ${playerName}`);
  }
  console.log('✅ Profile loaded cleanly for Jasprit Bumrah:', playerName);

  console.log('\n🎉 AUTO-REGISTRATION, SQUAD PERSISTENCE & SEARCH TESTS PASSED!\n');
}

testAutoRegistrationAndSearch()
  .catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  });
