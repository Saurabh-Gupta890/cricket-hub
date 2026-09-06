const io = require('socket.io-client');
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

async function testSquadPersistenceAndManagement() {
  console.log('🧪 Starting Squad Persistence & Management Test...');

  // 1. Create a Captain and register
  const captainPhone = '9999000111';
  const captainName = 'Virat Kohli';

  // Request OTP & verify using received devOtp
  let otpRes = await postJSON('/api/auth/request-otp', { phone: captainPhone, name: captainName, mode: 'login' });
  if (otpRes.error && otpRes.error.includes('Sign Up')) {
    otpRes = await postJSON('/api/auth/request-otp', { phone: captainPhone, name: captainName, mode: 'signup' });
  }
  const authRes = await postJSON('/api/auth/verify-otp', {
    phone: captainPhone,
    otp: otpRes.devOtp,
    name: captainName
  });
  console.log('✅ Captain logged in:', authRes.user.name);

  // 2. Create Squad / Group
  const groupRes = await postJSON('/api/groups/create', {
    name: 'RCB Legends XI',
    creatorPhone: captainPhone,
    creatorName: captainName
  });
  const group = groupRes.group;
  console.log('✅ Created squad:', group.name, 'with ID:', group.id, 'members:', group.members.length);

  // 3. Add players to the squad
  await postJSON(`/api/groups/${group.id}/add-member`, {
    phone: '9999000222',
    name: 'AB de Villiers',
    role: 'Batsman'
  });
  await postJSON(`/api/groups/${group.id}/add-member`, {
    phone: '9999000333',
    name: 'Chris Gayle',
    role: 'All-Rounder'
  });
  const addSiraj = await postJSON(`/api/groups/${group.id}/add-member`, {
    phone: '9999000444',
    name: 'Mohammed Siraj',
    role: 'Bowler'
  });
  console.log('✅ Added AB, Gayle, and Siraj to squad. Total members now:', addSiraj.group.members.length);
  if (!addSiraj.group.members.find(m => m.name === 'Mohammed Siraj')) {
    throw new Error('Failed to add Siraj to group');
  }

  // 4. Remove Chris Gayle
  const remRes = await postJSON(`/api/groups/${group.id}/remove-member`, {
    phone: '9999000333'
  });
  console.log('✅ Removed Gayle from squad. Total members now:', remRes.group.members.length);
  if (remRes.group.members.find(m => m.name === 'Chris Gayle')) {
    throw new Error('Failed to remove Gayle from group');
  }

  // 5. Test One-Time Auto Squad attachment on new Match creation via Socket
  const socket = io(BASE_URL, { reconnection: false });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });

  const roomCreatePromise = new Promise((resolve) => {
    socket.on('room:created', (data) => resolve(data));
  });

  socket.emit('room:create', {
    matchName: 'Chinnaswamy Clash',
    creatorName: captainName,
    creatorPhone: captainPhone
  });

  const createdRoom = await roomCreatePromise;
  const planningMembersList = Object.values(createdRoom.planning?.members || {});
  console.log('✅ Created Match Room:', createdRoom.code);
  console.log('   Attached Group Name:', createdRoom.groupName);
  console.log('   Attached Group ID:', createdRoom.groupId);
  console.log('   Pre-populated Planning Members:', planningMembersList.map(m => m.name));

  if (!createdRoom.groupId) {
    throw new Error('Expected room to auto-bind to a squad!');
  }
  if (!planningMembersList.find(m => m.name === 'Mohammed Siraj')) {
    throw new Error('Mohammed Siraj should be in the planning roster!');
  }
  if (planningMembersList.find(m => m.name === 'Chris Gayle')) {
    throw new Error('Chris Gayle should NOT be in the planning roster!');
  }

  // 6. Test real-time roster removal from an active room when removed from squad
  const updatePromise = new Promise((resolve) => {
    socket.on('planning:update', (roomState) => {
      resolve(roomState);
    });
  });

  await postJSON(`/api/groups/${createdRoom.groupId}/remove-member`, {
    phone: '9999000444' // Remove Siraj while room is active
  });

  const updatedRoom = await updatePromise;
  console.log('✅ Real-time match room update received!');
  console.log('   Updated Planning Members:', Object.values(updatedRoom.planning.members).map(m => m.name));
  if (updatedRoom.planning.members['9999000444']) {
    throw new Error('Siraj should have been removed in real-time from active match room!');
  }

  socket.disconnect();
  console.log('\n🎉 ALL SQUAD PERSISTENCE & ADD/REMOVE TESTS PASSED PERFECTLY!\n');
}

testSquadPersistenceAndManagement()
  .catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
  });
