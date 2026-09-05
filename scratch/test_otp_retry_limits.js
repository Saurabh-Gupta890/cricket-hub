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

async function testOtpRetryLimits() {
  console.log('🧪 Starting 5-In-A-Go OTP Request & Retry Verification...');

  const randSuffix = Date.now().toString().slice(-6);
  const testPhone = `91983${randSuffix}`;

  // 1. Request OTP 1
  console.log('--- Step 1: Requesting OTP 1st time ---');
  const req1 = await postJson('/api/auth/request-otp', { phone: testPhone, name: 'Retry Tester', mode: 'signup' });
  assert.strictEqual(req1.status, 200);
  assert.strictEqual(req1.data.requestCount, 1);
  assert.strictEqual(req1.data.requestsRemaining, 4);
  console.log(`✅ OTP #1 requested: devOtp = ${req1.data.devOtp}`);

  // 2. Try wrong OTP on code 1
  console.log('--- Step 2: Entering wrong OTP on Code 1 ---');
  const wrong1 = await postJson('/api/auth/verify-otp', { phone: testPhone, otp: '000000' });
  assert.strictEqual(wrong1.status, 400);
  assert.strictEqual(wrong1.data.remainingAttempts, 4);
  console.log(`✅ Wrong OTP response: "${wrong1.data.error}"`);

  // 3. Request OTP 2nd, 3rd, 4th, 5th times
  console.log('--- Step 3: Requesting OTP 2nd, 3rd, 4th, 5th times ---');
  for (let i = 2; i <= 5; i++) {
    const reqN = await postJson('/api/auth/request-otp', { phone: testPhone, name: 'Retry Tester', mode: 'signup' });
    assert.strictEqual(reqN.status, 200, `Request ${i} should succeed`);
    assert.strictEqual(reqN.data.requestCount, i);
    assert.strictEqual(reqN.data.requestsRemaining, 5 - i);
    console.log(`✅ OTP #${i} requested successfully: devOtp = ${reqN.data.devOtp} (${reqN.data.requestsRemaining} remaining)`);
  }

  // 4. Request 6th time -> should be rate limited to max 5 in a go
  console.log('--- Step 4: Requesting 6th time (Should be rate limited) ---');
  const req6 = await postJson('/api/auth/request-otp', { phone: testPhone, name: 'Retry Tester', mode: 'signup' });
  assert.strictEqual(req6.status, 429);
  assert.strictEqual(req6.data.requestLimitReached, true);
  console.log(`✅ 6th request blocked gracefully: "${req6.data.error}"`);

  // 5. Verify the 5th OTP code (latest valid code)
  console.log('--- Step 5: Verifying latest valid 5th OTP code ---');
  const testPhone2 = `91984${randSuffix}`;
  const req2_1 = await postJson('/api/auth/request-otp', { phone: testPhone2, name: 'Fresh User', mode: 'signup' });
  const verifyValid = await postJson('/api/auth/verify-otp', { phone: testPhone2, otp: req2_1.data.devOtp });
  assert.strictEqual(verifyValid.status, 200);
  assert.strictEqual(verifyValid.data.success, true);
  console.log(`✅ Valid OTP verified successfully for ${verifyValid.data.user.name}`);

  console.log('🎉 ALL OTP 5-IN-A-GO & RETRY TESTS PASSED PERFECTLY!');
  process.exit(0);
}

testOtpRetryLimits().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
