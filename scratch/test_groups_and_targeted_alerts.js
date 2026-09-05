const io = require('socket.io-client');
const http = require('http');
const assert = require('assert');

function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
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

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    }).on('error', reject);
  });
}

async function loginUser(phone, name) {
  const otpRes = await postJson('/api/auth/request-otp', { phone, name, mode: 'signup' });
  const verifyRes = await postJson('/api/auth/verify-otp', { phone, otp: otpRes.devOtp });
  return verifyRes;
}

async function testGroupsAndTargetedAlerts() {
  console.log('🧪 Starting Groups & Targeted Alerts Verification Suite...');

  const randSuffix = Date.now().toString().slice(-5);
  const phoneA = `91981${randSuffix}1`;
  const phoneB = `91981${randSuffix}2`;
  const phoneC = `91981${randSuffix}3`;

  const userA = await loginUser(phoneA, 'Alice Captain');
  const userB = await loginUser(phoneB, 'Bob Batsman');
  const userC = await loginUser(phoneC, 'Charlie Outsider');

  console.log('✅ Users authenticated: Alice, Bob, Charlie');

  const createRes = await postJson('/api/groups/create', {
    name: 'Thunderbolts XI',
    description: 'Sunday morning friendly cricket club',
    creatorPhone: phoneA,
    creatorName: 'Alice Captain'
  });

  assert.strictEqual(createRes.success, true);
  const groupA = createRes.group;
  console.log(`✅ Created Group: "${groupA.name}" (ID: ${groupA.id}, Code: ${groupA.code})`);

  const joinRes = await postJson('/api/groups/join', {
    code: groupA.code,
    phone: phoneB,
    name: 'Bob Batsman'
  });

  assert.strictEqual(joinRes.success, true);
  console.log('✅ Bob joined Thunderbolts XI via Code');

  const addMemRes = await postJson(`/api/groups/${groupA.id}/add-member`, {
    name: 'David Bowler',
    phone: `91981${randSuffix}4`,
    role: 'member'
  });

  assert.strictEqual(addMemRes.success, true);
  assert.strictEqual(addMemRes.group.members.length, 3);
  console.log('✅ Added player "David Bowler" directly into Thunderbolts XI squad roster');

  const SERVER_URL = 'http://localhost:3000';
  const socketA = io(SERVER_URL);
  const socketB = io(SERVER_URL);
  const socketC = io(SERVER_URL);

  await new Promise(r => setTimeout(r, 600));

  socketA.emit('user:register', { token: userA.token, phone: phoneA, name: 'Alice Captain' });
  socketB.emit('user:register', { token: userB.token, phone: phoneB, name: 'Bob Batsman' });
  socketC.emit('user:register', { token: userC.token, phone: phoneC, name: 'Charlie Outsider' });

  const roomCreated = await new Promise((resolve) => {
    socketA.emit('room:create', {
      token: userA.token,
      matchName: 'Sunday Derby',
      format: 'T20',
      overs: 20
    }, resolve);
  });

  assert.strictEqual(roomCreated.success, true);
  const roomCode = roomCreated.room.code;
  console.log(`✅ Room created: ${roomCode}`);

  const setGroupRes = await new Promise((resolve) => {
    socketA.emit('room:setGroup', {
      code: roomCode,
      groupId: groupA.id
    }, resolve);
  });
  assert.strictEqual(setGroupRes.success, true);
  assert.strictEqual(setGroupRes.room.groupId, groupA.id);
  console.log(`✅ Match Room ${roomCode} linked to group: ${setGroupRes.room.groupName}`);

  await new Promise((resolve) => {
    socketB.emit('room:join', { token: userB.token, code: roomCode }, resolve);
  });

  let bobReceivedAlert = false;
  let charlieReceivedAlert = false;

  socketB.on('popup:alert', (alert) => {
    console.log('🔔 Bob received targeted alert:', alert.message);
    bobReceivedAlert = true;
  });

  socketC.on('popup:alert', (alert) => {
    console.log('❌ Charlie received alert unexpectedly:', alert.message);
    charlieReceivedAlert = true;
  });

  socketA.emit('planning:nudge', {
    code: roomCode,
    type: 'custom',
    customMessage: 'Squad Assembly: Match starts at 8:00 AM!'
  });

  await new Promise(r => setTimeout(r, 1500));

  assert.strictEqual(bobReceivedAlert, true, 'Bob (Squad A member) should have received the targeted alert');
  assert.strictEqual(charlieReceivedAlert, false, 'Charlie (Outsider) MUST NOT receive alerts from another squad/room');
  console.log('🎯 Targeted Alert Isolation Verified: Bob received ping, Charlie received ZERO unwanted alerts!');

  socketA.disconnect();
  socketB.disconnect();
  socketC.disconnect();

  console.log('🎉 ALL GROUPS & TARGETED ALERTS TESTS PASSED PERFECTLY!');
  process.exit(0);
}

testGroupsAndTargetedAlerts().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
