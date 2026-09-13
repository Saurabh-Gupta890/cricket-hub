#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PROJECT-WIDE SECRETS & CREDENTIALS SCANNER
 * ═══════════════════════════════════════════════════════════════════════
 *  Scans public frontend assets, server code, and git repository files
 *  to guarantee that API keys, database connection strings, tokens,
 *  and private keys are never exposed in client bundles or repositories.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

console.log('🔍 [Secrets Scanner] Scanning project files for exposed credentials & API keys...\n');

const secretSignatures = [
  { name: 'Private Key Block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'MongoDB URI with Password', pattern: /mongodb(\+srv)?:\/\/[^:\s'"]+:[^@\s'"]+@/i },
  { name: 'AWS Access Key ID', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Google Cloud / Maps API Key', pattern: /AIza[0-9A-Za-z-_]{35}/ },
  { name: 'Stripe Live Secret Key', pattern: /sk_live_[0-9a-zA-Z]{24}/ },
  { name: 'Slack Bot / Webhook Token', pattern: /xox[baprs]-[0-9a-zA-Z]{10,48}/ },
  { name: 'GitHub Personal Access Token', pattern: /gh[pousr]_[0-9a-zA-Z]{36}/ },
  { name: 'Hardcoded VAPID Private Key', pattern: /vapid_private_key\s*=\s*['"][A-Za-z0-9_-]{20,}['"]/i }
];

// Directories and files to scan
const targetDirectories = ['public', 'src', 'scripts'];
const individualFiles = ['server.js', 'package.json', 'Dockerfile'];

let totalFilesScanned = 0;
let violationsFound = 0;

function scanFile(filePath, isClientBundle = false) {
  totalFilesScanned++;
  const content = fs.readFileSync(filePath, 'utf-8');
  const relPath = path.relative(ROOT_DIR, filePath);

  for (const sig of secretSignatures) {
    if (sig.pattern.test(content)) {
      console.error(`❌ CRITICAL SECURITY VIOLATION: ${sig.name} detected in ${relPath}!`);
      violationsFound++;
    }
  }

  // Extra check for client bundles: no environment variable references or server paths
  if (isClientBundle) {
    if (content.includes('process.env.MONGODB_URI') || content.includes('process.env.VAPID_PRIVATE_KEY')) {
      console.error(`❌ CRITICAL: Server-only environment variable referenced in client bundle: ${relPath}`);
      violationsFound++;
    }
  }
}

function scanDirectory(dirPath, isClientBundle = false) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        scanDirectory(fullPath, isClientBundle || entry.name === 'public');
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (['.js', '.html', '.css', '.json', '.ts', '.tsx', '.md'].includes(ext)) {
        scanFile(fullPath, isClientBundle);
      }
    }
  }
}

// 1. Scan client assets in public/
scanDirectory(path.join(ROOT_DIR, 'public'), true);

// 2. Scan backend and source files
scanDirectory(path.join(ROOT_DIR, 'src'), false);
scanDirectory(path.join(ROOT_DIR, 'scripts'), false);

// 3. Scan root server files
for (const file of individualFiles) {
  const fullPath = path.join(ROOT_DIR, file);
  if (fs.existsSync(fullPath)) {
    scanFile(fullPath, false);
  }
}

console.log(`\n📊 Scan Completed: ${totalFilesScanned} files analyzed.`);

if (violationsFound === 0) {
  console.log('🎉 ZERO Exposed Secrets Detected: All credentials securely encapsulated on server!\n');
  process.exit(0);
} else {
  console.error(`🚨 Security Scan Failed: Found ${violationsFound} credential violations!\n`);
  process.exit(1);
}
