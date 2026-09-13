#!/usr/bin/env node
/**
 * CricketHub Database Snapshot & Backup CLI Tool
 */

const { createBackup, listBackups } = require('../src/utils/backup_recovery');

console.log('📦 Starting CricketHub Point-in-Time Database Backup Snapshot...\n');
const result = createBackup(null, process.argv[2] || 'manual_cli');

if (result.success) {
  console.log(`✅ Backup Completed Successfully!`);
  console.log(`   🏷️  Backup ID:     ${result.backupId}`);
  console.log(`   📂 Location:      ${result.backupPath}`);
  console.log(`   📊 Files Saved:   ${Object.keys(result.manifest.files).length}`);
  console.log(`   🏏 Matches Stored: ${result.manifest.matchesCount}`);
  console.log(`   💾 Total Size:    ${(result.manifest.totalSizeBytes / 1024).toFixed(2)} KB\n`);

  console.log('📋 Recent Backups History:');
  const recent = listBackups().slice(0, 5);
  for (const b of recent) {
    console.log(`   • [${b.timestamp}] ${b.backupId} (${(b.totalSizeBytes / 1024).toFixed(1)} KB, ${b.matchesCount} matches)`);
  }
} else {
  console.error('❌ Backup Failed:', result.error);
  process.exit(1);
}
