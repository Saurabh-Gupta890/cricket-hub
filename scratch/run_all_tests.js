/**
 * Comprehensive Test Harness: Executes all test scripts in scratch/
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRATCH_DIR = path.join(__dirname);
const testFiles = fs.readdirSync(SCRATCH_DIR)
  .filter(f => f.startsWith('test_') || f.startsWith('master_') || f.startsWith('simulate_'))
  .filter(f => f.endsWith('.js') && f !== 'run_all_tests.js')
  .sort();

console.log(`\n🏏 Discovered ${testFiles.length} test scripts to execute.`);
console.log('═'.repeat(70));

const results = [];

async function runTest(file) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const child = spawn('node', [path.join(SCRATCH_DIR, file)], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: '3000' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      resolve({ file, passed: false, duration, error: 'TIMEOUT (>45s)' });
    }, 45000);

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      if (code === 0) {
        resolve({ file, passed: true, duration });
      } else {
        const errSnippet = (stderr || stdout).split('\n').filter(Boolean).slice(-4).join(' | ');
        resolve({ file, passed: false, duration, code, error: errSnippet });
      }
    });
  });
}

async function runAll() {
  let passedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < testFiles.length; i++) {
    const file = testFiles[i];
    process.stdout.write(`[${i + 1}/${testFiles.length}] Running ${file}... `);
    const res = await runTest(file);
    results.push(res);

    if (res.passed) {
      passedCount++;
      console.log(`✅ PASS (${res.duration}s)`);
    } else {
      failedCount++;
      console.log(`❌ FAIL (${res.duration}s)`);
      if (res.error) console.log(`    ↳ Error: ${res.error}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`🏁 TEST EXECUTION SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED out of ${testFiles.length} total.`);
  console.log('═'.repeat(70) + '\n');

  if (failedCount > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.passed).forEach(r => console.log(` - ${r.file}: ${r.error}`));
    process.exit(1);
  } else {
    console.log('🎉 ALL TEST SCRIPTS PASSED 100%!');
    process.exit(0);
  }
}

runAll();
