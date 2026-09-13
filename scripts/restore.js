#!/usr/bin/env node
/**
 * CricketHub Disaster Recovery & Database Restoration CLI Tool
 */

const { restoreBackup, listBackups, verifyBackupIntegrity } = require('../src/utils/backup_recovery');

const backupIdArg = process.argv[2];

if (!backupIdArg) {
  console.log('🔄 CricketHub Disaster Recovery — Available Snapshot Backups:\n');
  const available = listBackups();
  if (available.length === 0) {
    console.log('   ⚠️  No backup snapshots found in "backups/" directory.');
    process.exit(0);
  }
  available.forEach((b, idx) => {
    console.log(`   ${idx + 1}. ${b.backupId} [${b.timestamp}] — ${Object.keys(b.files).length} files, ${b.matchesCount} matches`);
  });
  console.log('\nUsage: node scripts/restore.js <backup_id>');
  console.log('Example: node scripts/restore.js ' + available[0].backupId);
  process.exit(0);
}

console.log(`🛡️ Verifying backup integrity for "${backupIdArg}"...`);
const integrity = verifyBackupIntegrity(backupIdArg);

if (!integrity.valid) {
  console.error(`❌ Integrity Check Failed: ${integrity.error}`);
  process.exit(1);
}

console.log(`✅ SHA-256 Checksums Verified 100%! Initiating database restoration...`);
const res = restoreBackup(backupIdArg);

if (res.success) {
  console.log(`🎉 Disaster Recovery Restoration Successful!`);
  console.log(`   📂 Restored To:     ${res.restoredTo}`);
  console.log(`   📄 Files Restored:  ${res.filesRestored}`);
} else {
  console.error(`❌ Disaster Recovery Restoration Failed: ${res.error}`);
  process.exit(1);
}
