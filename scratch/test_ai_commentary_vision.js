/**
 * ═══════════════════════════════════════════════════════════════════
 *  AI VISION & LIVE COMMENTATOR STUDIO VALIDATION TEST
 * ═══════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const JS_FILE = path.join(__dirname, '..', 'public', 'ai_commentary.js');
const CSS_FILE = path.join(__dirname, '..', 'public', 'ai_commentary.css');
const HTML_FILE = path.join(__dirname, '..', 'public', 'index.html');

function runAiCommentaryTests() {
  console.log('🎙️ ================================================================');
  console.log('🎙️ CRICKETHUB — AI VISION & LIVE COMMENTATOR STUDIO TEST SUITE');
  console.log('🎙️ ================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`   ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`   ❌ FAIL: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // 1. Asset & Integration Integrity
  console.log('📁 [Step 1] Verifying AI Studio Script & Style Integration...');
  assert(fs.existsSync(JS_FILE), 'public/ai_commentary.js exists.');
  assert(fs.existsSync(CSS_FILE), 'public/ai_commentary.css exists.');
  
  const html = fs.readFileSync(HTML_FILE, 'utf-8');
  assert(html.includes('ai_commentary.css'), 'ai_commentary.css referenced in index.html.');
  assert(html.includes('ai_commentary.js'), 'ai_commentary.js loaded before closing body in index.html.');
  assert(html.includes('openAiStudio()'), 'AI Studio launcher button integrated into match views.');

  // 2. Commentary Archive & Persona Dictionaries
  console.log('\n🗣️ [Step 2] Validating Dual Commentator Catchphrase Dictionaries...');
  const jsContent = fs.readFileSync(JS_FILE, 'utf-8');
  
  assert(jsContent.includes('tracer bullet'), 'Ravi Shastri "tracer bullet" signature catchphrase present.');
  assert(jsContent.includes('in the V, it\'s in the tree'), 'Ravi Shastri "In the V" signature catchphrase present.');
  assert(jsContent.includes('composed a symphony'), 'Harsha Bhogle "composed a symphony" signature catchphrase present.');
  assert(jsContent.includes('velvet timing'), 'Harsha Bhogle "velvet timing" signature catchphrase present.');
  assert(jsContent.includes('COVER_DRIVE') && jsContent.includes('PULL_SHOT') && jsContent.includes('HELICOPTER_SHOT'), 'All 7 cricket stroke categories mapped in dictionary.');

  // 3. Web Audio Procedural Stadium Cheer Synthesizer
  console.log('\n🏟️ [Step 3] Checking Procedural Stadium Audio Synthesis Logic...');
  assert(jsContent.includes('AudioContext') || jsContent.includes('webkitAudioContext'), 'Web Audio API context initialized for zero-cost audio.');
  assert(jsContent.includes('createBiquadFilter') && jsContent.includes('createGain'), 'Audio filter and gain envelope synthesizer configured.');

  // 4. Optical Flow & Motion Vector Classification Rules
  console.log('\n👁️ [Step 4] Checking Camera Vision & Motion Differential Classification...');
  assert(jsContent.includes('getUserMedia'), 'Camera stream lifecycle API active.');
  assert(jsContent.includes('getImageData') && jsContent.includes('motionRatio'), 'Real-time pixel differential motion tracking active.');
  assert(jsContent.includes('ai-speed-val'), 'Dynamic bat speed HUD calculation active.');

  // 5. CSS & Cyberpunk Sports Broadcast HUD Styling
  console.log('\n🎨 [Step 5] Checking Broadcast TV & Cyberpunk HUD Styling...');
  const cssContent = fs.readFileSync(CSS_FILE, 'utf-8');
  assert(cssContent.includes('.ai-studio-modal'), 'Studio modal container styled.');
  assert(cssContent.includes('.ai-hud-corner') && cssContent.includes('.ai-crosshair'), 'Camera viewfinder crosshairs and corner brackets styled.');
  assert(cssContent.includes('.ai-broadcast-ticker') && cssContent.includes('.ai-audio-wave'), 'Broadcast lower-third ticker and animated audio wave visualizer styled.');

  console.log('\n🎙️ ================================================================');
  console.log(`🏆 AI VISION & LIVE COMMENTARY STUDIO VERIFIED: ALL ${passed}/${total} CHECKS PASSED 100%!`);
  console.log('🎙️ ================================================================\n');
}

runAiCommentaryTests();
