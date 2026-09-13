/**
 * Automated Verification: Terms of Use, Privacy Policy & Data Declaration
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('⚖️ Starting Terms of Use, Privacy Policy & Data Declaration Verification...\n');

// 1. Verify Root Markdown Documentation
console.log('📚 Test 1: Checking root markdown documents...');
const rootDocs = [
  'terms_of_use.md',
  'privacy_policy.md',
  'data_declaration.md',
  'prd.md',
  'architecture.md',
  'rules.md',
  'phases.md',
  'design.md',
  'memory.md'
];

rootDocs.forEach(doc => {
  const fullPath = path.join(__dirname, '..', doc);
  assert.ok(fs.existsSync(fullPath), `Document ${doc} must exist in root`);
  const content = fs.readFileSync(fullPath, 'utf8');
  assert.ok(content.length > 500, `Document ${doc} must have substantial content`);
  console.log(`✅ ${doc} verified (${content.length} bytes)`);
});

// 2. Verify Index.html Legal Integration
console.log('\n🛡️ Test 2: Verifying index.html Legal Center & Footers...');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.ok(indexHtml.includes('legal-tab-terms'), 'index.html must have Terms of Use tab');
assert.ok(indexHtml.includes('legal-tab-privacy'), 'index.html must have Privacy Policy tab');
assert.ok(indexHtml.includes('legal-tab-data'), 'index.html must have Data Declaration tab');
assert.ok(indexHtml.includes('legal-table'), 'index.html must have Data Declaration inventory table');
assert.ok(indexHtml.includes('exportMyUserData()'), 'index.html must have exportMyUserData button');
assert.ok(indexHtml.includes('requestDataErasure()'), 'index.html must have requestDataErasure button');
assert.ok(indexHtml.includes('legal-footer-bar'), 'index.html must have legal-footer-bar');
console.log('✅ index.html Legal Center & footer links verified');

// 3. Verify cookie-consent.js Legal Controller
console.log('\n🍪 Test 3: Verifying cookie-consent.js Legal controller & data portability...');
const cookieJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'cookie-consent.js'), 'utf8');

assert.ok(cookieJs.includes('switchLegalTab'), 'cookie-consent.js must define switchLegalTab');
assert.ok(cookieJs.includes('openLegalModal'), 'cookie-consent.js must define openLegalModal');
assert.ok(cookieJs.includes('openTermsModal'), 'cookie-consent.js must define openTermsModal');
assert.ok(cookieJs.includes('openDataDeclarationModal'), 'cookie-consent.js must define openDataDeclarationModal');
assert.ok(cookieJs.includes('exportMyUserData'), 'cookie-consent.js must define exportMyUserData');
assert.ok(cookieJs.includes('requestDataErasure'), 'cookie-consent.js must define requestDataErasure');
console.log('✅ cookie-consent.js controller methods verified');

// 4. Verify style.css Legal UI Styling
console.log('\n🎨 Test 4: Verifying style.css Legal Center styling...');
const styleCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

assert.ok(styleCss.includes('.legal-modal-tabs'), 'style.css must have .legal-modal-tabs');
assert.ok(styleCss.includes('.legal-tab-btn'), 'style.css must have .legal-tab-btn');
assert.ok(styleCss.includes('.legal-table'), 'style.css must have .legal-table');
assert.ok(styleCss.includes('.legal-badge-pii'), 'style.css must have .legal-badge-pii');
assert.ok(styleCss.includes('.legal-footer-bar'), 'style.css must have .legal-footer-bar');
console.log('✅ style.css Legal UI styles verified');

console.log('\n🎉 ALL TERMS OF USE, PRIVACY POLICY & DATA DECLARATION TESTS PASSED 100%!\n');
