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
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function testLoginSignupDevMode() {
  console.log('🧪 Testing Sign Up, Log In, and Dev Mode OTP Generation...');

  const randPhone = `91987${Date.now().toString().slice(-6)}`;

  // 1. New user attempts Login -> should inform user to Sign Up
  console.log('\n--- 1. Testing Login with non-existent user ---');
  const loginNotFound = await postJson('/api/auth/request-otp', {
    phone: randPhone,
    mode: 'login'
  });
  assert.strictEqual(loginNotFound.status, 404);
  assert.strictEqual(loginNotFound.data.notFound, true);
  console.log('✅ Correctly prompted to switch to Sign Up');

  // 2. Sign Up as new user with Player Name
  console.log('\n--- 2. Testing Sign Up as new user ---');
  const signupRes = await postJson('/api/auth/request-otp', {
    phone: randPhone,
    name: 'Shubman Gill',
    mode: 'signup'
  });
  assert.strictEqual(signupRes.status, 200);
  assert.strictEqual(signupRes.data.success, true);
  assert.strictEqual(signupRes.data.isNew, true);
  assert.strictEqual(typeof signupRes.data.devOtp, 'string');
  assert.strictEqual(signupRes.data.devOtp.length, 6);
  console.log(`✅ Sign Up generated OTP in Dev Mode: ${signupRes.data.devOtp}`);

  // 3. Verify OTP for Sign Up
  console.log('\n--- 3. Verifying Sign Up OTP ---');
  const verifySignup = await postJson('/api/auth/verify-otp', {
    phone: randPhone,
    otp: signupRes.data.devOtp
  });
  assert.strictEqual(verifySignup.status, 200);
  assert.strictEqual(verifySignup.data.success, true);
  assert.strictEqual(verifySignup.data.user.name, 'Shubman Gill');
  console.log('✅ Sign Up verified and account created successfully');

  // 4. Now Log In with the existing account
  console.log('\n--- 4. Logging In with the newly created account ---');
  const loginRes = await postJson('/api/auth/request-otp', {
    phone: randPhone,
    mode: 'login'
  });
  assert.strictEqual(loginRes.status, 200);
  assert.strictEqual(loginRes.data.success, true);
  assert.strictEqual(typeof loginRes.data.devOtp, 'string');
  console.log(`✅ Login generated OTP in Dev Mode: ${loginRes.data.devOtp}`);

  // 5. Verify Login OTP
  console.log('\n--- 5. Verifying Login OTP ---');
  const verifyLogin = await postJson('/api/auth/verify-otp', {
    phone: randPhone,
    otp: loginRes.data.devOtp
  });
  assert.strictEqual(verifyLogin.status, 200);
  assert.strictEqual(verifyLogin.data.success, true);
  assert.strictEqual(verifyLogin.data.user.name, 'Shubman Gill');
  console.log('✅ Logged in successfully with existing account');

  console.log('\n🎉 ALL SIGN UP, LOG IN, AND DEV MODE OTP TESTS PASSED PERFECTLY!');
  process.exit(0);
}

testLoginSignupDevMode().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
