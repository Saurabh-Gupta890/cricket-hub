const BASE_URL = 'http://localhost:3000';

async function testAuthClientFlow() {
  console.log('🧪 Testing Full Auth Flow (Sign Up, OTP, Login)...');

  const rand = Math.floor(1000 + Math.random() * 9000);
  const testPhone = `98765${rand}`;
  const testName = `Player ${rand}`;

  // 1. Sign Up mode OTP request
  console.log(`\n--- Step 1: Requesting OTP for Sign Up: ${testName} (+91${testPhone}) ---`);
  const reqRes = await fetch(`${BASE_URL}/api/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: `91${testPhone}`, name: testName, mode: 'signup' })
  });
  const reqData = await reqRes.json();
  console.log('Request Response:', reqData);

  if (!reqData.success || !reqData.devOtp) {
    throw new Error('Sign Up OTP request failed');
  }
  console.log('✅ Received dev OTP:', reqData.devOtp);

  // 2. Verify OTP
  console.log('\n--- Step 2: Verifying OTP ---');
  const verRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: `91${testPhone}`, otp: reqData.devOtp })
  });
  const verData = await verRes.json();
  console.log('Verify Response:', verData);

  if (!verData.success || !verData.token || !verData.user) {
    throw new Error('OTP verification failed');
  }
  console.log('✅ Verified & Session Created! User:', verData.user.name, 'Token:', verData.token.slice(0, 10) + '...');

  // 3. Validate Session Token via /api/auth/me
  console.log('\n--- Step 3: Validating session token ---');
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: verData.token })
  });
  const meData = await meRes.json();
  if (!meData.success || meData.user.name !== testName) {
    throw new Error('Session validation failed');
  }
  console.log('✅ Session validated successfully for:', meData.user.name);

  // 4. Log in with existing account
  console.log('\n--- Step 4: Testing Log In with existing account ---');
  const loginRes = await fetch(`${BASE_URL}/api/auth/request-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: `91${testPhone}`, mode: 'login' })
  });
  const loginData = await loginRes.json();
  if (!loginData.success || !loginData.devOtp) {
    throw new Error('Login OTP request failed');
  }
  console.log('✅ Login OTP requested successfully:', loginData.devOtp);

  const loginVerRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: `91${testPhone}`, otp: loginData.devOtp })
  });
  const loginVerData = await loginVerRes.json();
  if (!loginVerData.success) {
    throw new Error('Login verification failed');
  }
  console.log('✅ Logged in successfully with existing account:', loginVerData.user.name);

  console.log('\n🎉 ALL AUTH & OTP FLOW TESTS PASSED 100% PERFECTLY!\n');
}

testAuthClientFlow().catch(err => {
  console.error('❌ Auth test failed:', err);
  process.exit(1);
});
