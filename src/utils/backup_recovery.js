/**
 * ═══════════════════════════════════════════════════════════════════
 *  AUTOMATED BACKUP & DISASTER RECOVERY ENGINE (CricketHub)
 * ═══════════════════════════════════════════════════════════════════
 * Handles point-in-time snapshots, SHA-256 cryptographic verification,
 * safe disaster restoration, and automated snapshot rotation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeLog } = require('./logger');

const BACKUPS_DIR = path.join(__dirname, '..', '..', 'backups');

if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

/**
 * Calculates SHA-256 checksum of a file
 */
function calculateFileChecksum(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Creates a point-in-time backup snapshot
 */
function createBackup(sourceDir = null, label = 'auto') {
  const activeDataDir = sourceDir || (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', '..', 'data'));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = `backup_${timestamp}_${label}`;
  const targetDir = path.join(BACKUPS_DIR, backupId);

  fs.mkdirSync(targetDir, { recursive: true });

  const manifest = {
    backupId,
    timestamp: new Date().toISOString(),
    sourceDir: path.basename(activeDataDir),
    environment: process.env.NODE_ENV || 'development',
    files: {},
    matchesCount: 0,
    totalSizeBytes: 0
  };

  // 1. Copy root JSON files in data directory
  const rootFiles = ['users.json', 'rooms.json', 'groups.json', 'push_subscriptions.json', 'vapid.json'];
  for (const fileName of rootFiles) {
    const src = path.join(activeDataDir, fileName);
    if (fs.existsSync(src)) {
      const dest = path.join(targetDir, fileName);
      fs.copyFileSync(src, dest);
      const stat = fs.statSync(dest);
      const checksum = calculateFileChecksum(dest);
      manifest.files[fileName] = { size: stat.size, sha256: checksum };
      manifest.totalSizeBytes += stat.size;
    }
  }

  // 2. Copy match histories archive
  const srcMatchesDir = path.join(activeDataDir, 'matches');
  const destMatchesDir = path.join(targetDir, 'matches');
  if (fs.existsSync(srcMatchesDir)) {
    fs.mkdirSync(destMatchesDir, { recursive: true });
    const matchFiles = fs.readdirSync(srcMatchesDir).filter(f => f.endsWith('.json'));
    manifest.matchesCount = matchFiles.length;
    for (const mf of matchFiles) {
      const srcFile = path.join(srcMatchesDir, mf);
      const destFile = path.join(destMatchesDir, mf);
      fs.copyFileSync(srcFile, destFile);
      const stat = fs.statSync(destFile);
      const checksum = calculateFileChecksum(destFile);
      manifest.files[`matches/${mf}`] = { size: stat.size, sha256: checksum };
      manifest.totalSizeBytes += stat.size;
    }
  }

  // 3. Write manifest.json
  const manifestPath = path.join(targetDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  writeLog('backup', 'INFO', `Backup snapshot "${backupId}" created successfully`, {
    backupId,
    totalFiles: Object.keys(manifest.files).length,
    matchesArchived: manifest.matchesCount,
    totalSizeBytes: manifest.totalSizeBytes
  });

  // Auto-prune old snapshots
  pruneOldBackups();

  return {
    success: true,
    backupId,
    backupPath: targetDir,
    manifest
  };
}

/**
 * Lists all existing backups
 */
function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true });
  const backups = [];

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('backup_')) {
      const manifestPath = path.join(BACKUPS_DIR, entry.name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          backups.push(manifest);
        } catch (e) {
          // Ignored corrupted manifest
        }
      }
    }
  }

  // Sort descending by timestamp
  return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * Verifies the integrity of a backup snapshot using SHA-256 checksums
 */
function verifyBackupIntegrity(backupId) {
  const targetDir = path.join(BACKUPS_DIR, backupId);
  const manifestPath = path.join(targetDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return { valid: false, error: `Backup "${backupId}" does not exist or lacks manifest.json` };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    for (const [relPath, info] of Object.entries(manifest.files || {})) {
      const fullPath = path.join(targetDir, relPath);
      if (!fs.existsSync(fullPath)) {
        return { valid: false, error: `Missing file in backup: ${relPath}` };
      }
      const currentChecksum = calculateFileChecksum(fullPath);
      if (currentChecksum !== info.sha256) {
        return { valid: false, error: `Checksum mismatch for ${relPath} (expected: ${info.sha256}, got: ${currentChecksum})` };
      }
    }
    return { valid: true, manifest };
  } catch (err) {
    return { valid: false, error: `Failed to verify backup integrity: ${err.message}` };
  }
}

/**
 * Restores database from a point-in-time backup snapshot
 */
function restoreBackup(backupId, targetDataDir = null) {
  const activeDataDir = targetDataDir || (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', '..', 'data'));
  const backupDir = path.join(BACKUPS_DIR, backupId);

  // 1. Verify Integrity First
  const verification = verifyBackupIntegrity(backupId);
  if (!verification.valid) {
    writeLog('backup', 'ERROR', `Disaster recovery aborted: Checksum verification failed for ${backupId}`, { error: verification.error });
    return { success: false, error: verification.error };
  }

  // 2. Create emergency pre-restore snapshot of current data
  if (fs.existsSync(activeDataDir)) {
    try {
      createBackup(activeDataDir, 'pre_restore_safety_checkpoint');
    } catch (e) {
      console.warn('Pre-restore checkpoint creation failed:', e.message);
    }
  }

  // 3. Perform restoration
  try {
    if (!fs.existsSync(activeDataDir)) {
      fs.mkdirSync(activeDataDir, { recursive: true });
    }

    const manifest = verification.manifest;
    for (const [relPath, _] of Object.entries(manifest.files || {})) {
      const srcFile = path.join(backupDir, relPath);
      const destFile = path.join(activeDataDir, relPath);
      const destDir = path.dirname(destFile);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcFile, destFile);
    }

    writeLog('backup', 'INFO', `Disaster recovery restore completed successfully from "${backupId}"`, {
      backupId,
      restoredTo: path.basename(activeDataDir),
      filesRestored: Object.keys(manifest.files || {}).length
    });

    return {
      success: true,
      backupId,
      restoredTo: activeDataDir,
      filesRestored: Object.keys(manifest.files || {}).length
    };
  } catch (err) {
    writeLog('backup', 'ERROR', `Disaster recovery restore failed: ${err.message}`, { error: err.message });
    return { success: false, error: `Restoration failed: ${err.message}` };
  }
}

/**
 * Prunes old backups, retaining the most recent `maxSnapshots` (default: 10)
 */
function pruneOldBackups(maxSnapshots = 10) {
  try {
    const all = listBackups();
    if (all.length > maxSnapshots) {
      const toDelete = all.slice(maxSnapshots);
      for (const b of toDelete) {
        const dirToDelete = path.join(BACKUPS_DIR, b.backupId);
        if (fs.existsSync(dirToDelete)) {
          fs.rmSync(dirToDelete, { recursive: true, force: true });
          writeLog('backup', 'INFO', `Pruned aged backup snapshot "${b.backupId}"`, { backupId: b.backupId });
        }
      }
    }
  } catch (e) {
    console.error('Error pruning old backups:', e);
  }
}

/**
 * Initializes automatic background backup schedule
 */
let backupTimer = null;
function initScheduledBackups(intervalHours = 12) {
  if (backupTimer) clearInterval(backupTimer);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  backupTimer = setInterval(() => {
    try {
      console.log('⏰ Executing scheduled automated database backup...');
      createBackup(null, 'scheduled_cron');
    } catch (e) {
      console.error('Scheduled backup failed:', e);
    }
  }, intervalMs);
  if (backupTimer.unref) backupTimer.unref();
}

module.exports = {
  BACKUPS_DIR,
  createBackup,
  listBackups,
  verifyBackupIntegrity,
  restoreBackup,
  pruneOldBackups,
  initScheduledBackups
};
