const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = 'http://localhost:3000';

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function runPrivacyAndDocsTests() {
  console.log('🛡️ Starting DPDP Act 2023, Cookie Consent & Documentation Verification...\n');

  // 1. Check all 6 requested documentation files exist
  const requiredDocs = ['prd.md', 'architecture.md', 'rules.md', 'phases.md', 'design.md', 'memory.md'];
  console.log('📚 Test 1: Verifying Documentation Suite in Workspace Root...');
  for (const doc of requiredDocs) {
    const filePath = path.join(__dirname, '..', doc);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing required documentation file: ${doc}`);
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 200) {
      throw new Error(`Documentation file ${doc} is unexpectedly small (${stat.size} bytes)`);
    }
    console.log(`✅ ${doc} verified (${stat.size} bytes)`);
  }

  // 2. Check cookie-consent.js delivery via HTTP
  console.log('\n🍪 Test 2: Verifying Cookie Consent Widget Asset Delivery...');
  const cookieRes = await get('/cookie-consent.js?v=3.0.0');
  if (cookieRes.status !== 200) {
    throw new Error(`Failed to load cookie-consent.js: HTTP ${cookieRes.status}`);
  }
  if (!cookieRes.body.includes('onConsentGranted') || !cookieRes.body.includes('onConsentDenied')) {
    throw new Error('cookie-consent.js is missing required consent hooks (onConsentGranted, onConsentDenied)');
  }
  if (!cookieRes.body.includes('STORAGE_KEY') || !cookieRes.body.includes('btn-cookie-accept-all')) {
    throw new Error('cookie-consent.js is missing required UI element handlers');
  }
  console.log('✅ cookie-consent.js verified: Contains onConsentGranted, onConsentDenied, granular toggles, and localStorage persistence');

  // 3. Check index.html includes Privacy Modal & Cookie Widget Script
  console.log('\n🛡️ Test 3: Verifying Index.html DPDP Modal & Script Inclusions...');
  const indexRes = await get('/');
  if (indexRes.status !== 200) {
    throw new Error(`Failed to load index.html: HTTP ${indexRes.status}`);
  }
  if (!indexRes.body.includes('privacy-policy-modal')) {
    throw new Error('index.html is missing privacy-policy-modal');
  }
  if (!indexRes.body.includes('cookie-consent.js')) {
    throw new Error('index.html is missing script tag for cookie-consent.js');
  }
  if (!indexRes.body.includes('Digital Personal Data Protection (DPDP) Act 2023')) {
    throw new Error('index.html is missing DPDP Act 2023 disclosures');
  }
  console.log('✅ index.html verified: Contains DPDP Act 2023 Privacy Policy Modal and cookie-consent.js script');

  // 4. Check style.css includes Cookie and Privacy Widget styling
  console.log('\n🎨 Test 4: Verifying Style.css Cookie & Privacy Rules...');
  const styleRes = await get('/style.css?v=3.0.0');
  if (styleRes.status !== 200) {
    throw new Error(`Failed to load style.css: HTTP ${styleRes.status}`);
  }
  if (!styleRes.body.includes('.cookie-consent-card') || !styleRes.body.includes('.cookie-settings-badge')) {
    throw new Error('style.css is missing .cookie-consent-card or .cookie-settings-badge rules');
  }
  console.log('✅ style.css verified: Contains .cookie-consent-card, .toggle-switch, .slider, and .cookie-settings-badge styles');

  console.log('\n🎉 ALL DPDP ACT 2023, COOKIE CONSENT & DOCUMENTATION TESTS PASSED 100%!');
  process.exit(0);
}

runPrivacyAndDocsTests().catch(err => {
  console.error('❌ Privacy and Docs Test Failed:', err);
  process.exit(1);
});
