/**
 * ═══════════════════════════════════════════════════════════════════
 *  DISASTER RECOVERY & BACKUP E2E RESTORATION TEST
 * ═══════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const { createBackup, verifyBackupIntegrity, restoreBackup, listBackups } = require('../src/utils/backup_recovery');

const TEST_SANDBOX_DIR = path.join(__dirname, '..', 'data-recovery-sandbox');

async function testBackupAndRecovery() {
  console.log('🔄 ================================================================');
  console.log('🔄 CRICKETHUB — DISASTER RECOVERY & BACKUP VALIDATION TEST');
  console.log('🔄 ================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`   ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`   ❌ FAIL: ${message}`);
      throw new Error(`Backup test failed: ${message}`);
    }
  }

  try {
    // 1. Prepare Sandbox Source Data
    console.log('📁 [Step 1] Preparing simulated production database state...');
    if (fs.existsSync(TEST_SANDBOX_DIR)) {
      fs.rmSync(TEST_SANDBOX_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(TEST_SANDBOX_DIR, 'matches'), { recursive: true });

    const sampleUsers = {
      '9876500001': { phone: '9876500001', name: 'Rohit Sharma', role: 'Batsman' },
      '9876500002': { phone: '9876500002', name: 'Jasprit Bumrah', role: 'Bowler' }
    };
    const sampleRooms = {
      'CRK-RECV': { code: 'CRK-RECV', name: 'Final Match', hostPhone: '9876500001' }
    };

    fs.writeFileSync(path.join(TEST_SANDBOX_DIR, 'users.json'), JSON.stringify(sampleUsers, null, 2), 'utf-8');
    fs.writeFileSync(path.join(TEST_SANDBOX_DIR, 'rooms.json'), JSON.stringify(sampleRooms, null, 2), 'utf-8');
    fs.writeFileSync(path.join(TEST_SANDBOX_DIR, 'matches', 'match_001.json'), JSON.stringify({ matchId: '001', winner: 'Team A' }), 'utf-8');

    assert(fs.existsSync(path.join(TEST_SANDBOX_DIR, 'users.json')), 'Sandbox initial state created.');

    // 2. Execute Point-in-Time Backup Snapshot
    console.log('\n📦 [Step 2] Executing point-in-time backup snapshot...');
    const backupRes = createBackup(TEST_SANDBOX_DIR, 'e2e_recovery_test');
    assert(backupRes.success, `Backup "${backupRes.backupId}" created successfully.`);
    assert(backupRes.manifest.matchesCount === 1, 'Match history file included in backup snapshot.');

    // 3. Cryptographic Checksum Validation
    console.log('\n🔒 [Step 3] Cryptographic SHA-256 integrity verification...');
    const integrity = verifyBackupIntegrity(backupRes.backupId);
    assert(integrity.valid, 'All files passed SHA-256 checksum verification.');

    // 4. Simulate Disaster Event (Data Wipe & Corruption)
    console.log('\n💥 [Step 4] Simulating disaster scenario (database corruption)...');
    fs.writeFileSync(path.join(TEST_SANDBOX_DIR, 'users.json'), 'CORRUPTED_DISASTER_JUNK', 'utf-8');
    fs.rmSync(path.join(TEST_SANDBOX_DIR, 'rooms.json'), { force: true });
    fs.rmSync(path.join(TEST_SANDBOX_DIR, 'matches', 'match_001.json'), { force: true });
    assert(!fs.existsSync(path.join(TEST_SANDBOX_DIR, 'rooms.json')), 'Disaster condition successfully simulated.');

    // 5. Execute Automated Disaster Recovery Restoration
    console.log('\n🔄 [Step 5] Executing point-in-time disaster recovery restore...');
    const restoreRes = restoreBackup(backupRes.backupId, TEST_SANDBOX_DIR);
    assert(restoreRes.success, 'Disaster recovery restore executed successfully.');

    // 6. Verify Post-Recovery Data Integrity
    console.log('\n✨ [Step 6] Validating restored data against pre-disaster state...');
    const restoredUsersRaw = fs.readFileSync(path.join(TEST_SANDBOX_DIR, 'users.json'), 'utf-8');
    const restoredUsers = JSON.parse(restoredUsersRaw);
    assert(restoredUsers['9876500001']?.name === 'Rohit Sharma', 'Users database accurately restored.');
    
    const restoredRoomsRaw = fs.readFileSync(path.join(TEST_SANDBOX_DIR, 'rooms.json'), 'utf-8');
    const restoredRooms = JSON.parse(restoredRoomsRaw);
    assert(restoredRooms['CRK-RECV']?.name === 'Final Match', 'Rooms database accurately restored.');

    const restoredMatch = JSON.parse(fs.readFileSync(path.join(TEST_SANDBOX_DIR, 'matches', 'match_001.json'), 'utf-8'));
    assert(restoredMatch.winner === 'Team A', 'Archived matches accurately restored.');

    console.log('\n🔄 ================================================================');
    console.log(`🏆 DISASTER RECOVERY & BACKUPS VERIFIED: ALL ${passed}/${total} STEPS PASSED 100%!`);
    console.log('🔄 ================================================================\n');

  } finally {
    if (fs.existsSync(TEST_SANDBOX_DIR)) {
      fs.rmSync(TEST_SANDBOX_DIR, { recursive: true, force: true });
    }
  }
}

testBackupAndRecovery();
