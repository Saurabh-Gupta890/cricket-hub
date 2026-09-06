require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const compression = require('compression');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : '*';

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5e6 // 5MB max payload
});

const MATCHES_DIR = path.join(__dirname, 'data', 'matches');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const VAPID_FILE = path.join(__dirname, 'data', 'vapid.json');
const SUBS_FILE = path.join(__dirname, 'data', 'push_subscriptions.json');
const ROOMS_FILE = path.join(__dirname, 'data', 'rooms.json');
const GROUPS_FILE = path.join(__dirname, 'data', 'groups.json');

if (!fs.existsSync(MATCHES_DIR)) {
  fs.mkdirSync(MATCHES_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════
//  MONGODB CLOUD DATABASE INTEGRATION (DUAL-MODE)
// ═══════════════════════════════════════════════
const { MongoClient } = require('mongodb');

let mongoClient = null;
let mongoDb = null;
let isMongoConnected = false;

async function initCloudDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('ℹ️  No MONGODB_URI detected. Running in local JSON persistence mode.');
    return;
  }
  try {
    console.log('🌐 Connecting to MongoDB Atlas Cloud Database...');
    mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000
    });
    await mongoClient.connect();
    const dbName = process.env.MONGODB_DB_NAME || 'crickethub';
    mongoDb = mongoClient.db(dbName);
    isMongoConnected = true;
    console.log(`✅ Connected to MongoDB Atlas Cloud Database: "${dbName}"!`);

    await syncCloudData();
  } catch (err) {
    console.error('❌ Failed to connect to MongoDB Atlas:', err.message);
    console.warn('⚠️ Falling back to local JSON persistence mode.');
  }
}

async function syncCloudData() {
  if (!isMongoConnected || !mongoDb) return;
  try {
    const usersCol = mongoDb.collection('users');
    const roomsCol = mongoDb.collection('rooms');
    const groupsCol = mongoDb.collection('groups');
    const matchesCol = mongoDb.collection('matches');
    const subsCol = mongoDb.collection('push_subscriptions');

    // 1. Users Sync
    const cloudUsersCount = await usersCol.countDocuments();
    if (cloudUsersCount > 0) {
      const cloudUsers = await usersCol.find({}).toArray();
      for (const u of cloudUsers) {
        const { _id, ...userData } = u;
        const phone = userData.phone || _id;
        userStore.set(phone, userData);
        if (userData.token) tokenIndex.set(userData.token, phone);
      }
      saveUsersLocal();
      console.log(`☁️ Synced ${cloudUsers.length} users from MongoDB Cloud.`);
    } else if (userStore.size > 0) {
      const ops = [];
      for (const [phone, user] of userStore.entries()) {
        ops.push({ replaceOne: { filter: { _id: phone }, replacement: { _id: phone, ...user }, upsert: true } });
      }
      if (ops.length > 0) await usersCol.bulkWrite(ops);
      console.log(`☁️ Auto-migrated ${userStore.size} local users to MongoDB Cloud.`);
    }

    // 2. Groups Sync
    const cloudGroupsCount = await groupsCol.countDocuments();
    if (cloudGroupsCount > 0) {
      const cloudGroups = await groupsCol.find({}).toArray();
      for (const g of cloudGroups) {
        const { _id, ...groupData } = g;
        groups.set(_id, groupData);
      }
      saveGroupsLocal();
      console.log(`☁️ Synced ${cloudGroups.length} groups from MongoDB Cloud.`);
    } else if (groups.size > 0) {
      const ops = [];
      for (const [id, g] of groups.entries()) {
        ops.push({ replaceOne: { filter: { _id: id }, replacement: { _id: id, ...g }, upsert: true } });
      }
      if (ops.length > 0) await groupsCol.bulkWrite(ops);
      console.log(`☁️ Auto-migrated ${groups.size} local groups to MongoDB Cloud.`);
    }

    // 3. Rooms Sync
    const cloudRoomsCount = await roomsCol.countDocuments();
    if (cloudRoomsCount > 0) {
      const cloudRooms = await roomsCol.find({}).toArray();
      for (const r of cloudRooms) {
        const { _id, ...roomData } = r;
        rooms.set(_id, { ...roomData, sockets: {} });
        scheduleRoomExpiry(_id);
      }
      saveRoomsLocal();
      console.log(`☁️ Synced ${cloudRooms.length} active rooms from MongoDB Cloud.`);
    } else if (rooms.size > 0) {
      const ops = [];
      for (const [code, r] of rooms.entries()) {
        const persistObj = {
          code: r.code,
          matchName: r.matchName,
          hostPhone: r.hostPhone,
          groupId: r.groupId || null,
          planning: r.planning,
          match: r.match,
          createdAt: r.createdAt || Date.now()
        };
        ops.push({ replaceOne: { filter: { _id: code }, replacement: { _id: code, ...persistObj }, upsert: true } });
      }
      if (ops.length > 0) await roomsCol.bulkWrite(ops);
      console.log(`☁️ Auto-migrated ${rooms.size} local rooms to MongoDB Cloud.`);
    }

    // 4. Matches Sync
    const cloudMatchesCount = await matchesCol.countDocuments();
    if (cloudMatchesCount > 0) {
      const cloudMatches = await matchesCol.find({}).toArray();
      for (const m of cloudMatches) {
        const { _id, ...matchData } = m;
        const filePath = path.join(MATCHES_DIR, `${_id}.json`);
        safeWriteJsonFile(filePath, matchData);
      }
      console.log(`☁️ Synced ${cloudMatches.length} historical matches from MongoDB Cloud.`);
    } else if (fs.existsSync(MATCHES_DIR)) {
      const files = fs.readdirSync(MATCHES_DIR).filter(f => f.endsWith('.json'));
      const ops = [];
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(MATCHES_DIR, f), 'utf-8');
          const data = JSON.parse(raw);
          const id = data.id || f.replace('.json', '');
          ops.push({ replaceOne: { filter: { _id: id }, replacement: { _id: id, ...data }, upsert: true } });
        } catch (e) { }
      }
      if (ops.length > 0) {
        await matchesCol.bulkWrite(ops);
        console.log(`☁️ Auto-migrated ${ops.length} archived matches to MongoDB Cloud.`);
      }
    }

    // 5. Push Subscriptions Sync
    const cloudSubsCount = await subsCol.countDocuments();
    if (cloudSubsCount > 0) {
      const cloudSubs = await subsCol.find({}).toArray();
      for (const s of cloudSubs) {
        pushSubscriptions.set(s._id, s.subs || []);
      }
      saveSubscriptionsLocal();
      console.log(`☁️ Synced ${cloudSubs.length} push subscription records from MongoDB Cloud.`);
    } else if (pushSubscriptions.size > 0) {
      const ops = [];
      for (const [phone, subs] of pushSubscriptions.entries()) {
        ops.push({ replaceOne: { filter: { _id: phone }, replacement: { _id: phone, subs }, upsert: true } });
      }
      if (ops.length > 0) await subsCol.bulkWrite(ops);
      console.log(`☁️ Auto-migrated ${pushSubscriptions.size} push subscriptions to MongoDB Cloud.`);
    }
  } catch (err) {
    console.error('⚠️ Error syncing cloud data with MongoDB:', err);
  }
}

// ═══════════════════════════════════════════════
//  ATOMIC FILE PERSISTENCE HELPERS
// ═══════════════════════════════════════════════
function safeWriteJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempPath, jsonStr, 'utf-8');
    fs.renameSync(tempPath, filePath);
    return true;
  } catch (err) {
    console.error(`Atomic write failed for ${filePath}:`, err);
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) { }
    }
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch (e2) {
      console.error(`Direct write failed for ${filePath}:`, e2);
      return false;
    }
  }
}

function safeReadJsonFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to read JSON from ${filePath}:`, err);
    return fallback;
  }
}

// ═══════════════════════════════════════════════
//  SECURITY HEADERS & PAYLOAD LIMITS & COMPRESSION
// ═══════════════════════════════════════════════
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  threshold: 1024 // Only compress payloads > 1KB
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// Static assets with smart cache headers
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ═══════════════════════════════════════════════
//  HEALTH PROBE ENDPOINTS (Kubernetes / Render / AWS)
// ═══════════════════════════════════════════════
app.get(['/api/health', '/healthz'], (req, res) => {
  const mem = process.memoryUsage();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'UP',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    stats: {
      activeRooms: rooms.size,
      registeredUsers: userStore.size,
      activeSockets: io.engine.clientsCount || 0
    },
    memory: {
      rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`
    }
  });
});

// ═══════════════════════════════════════════════
//  RATE LIMITING & BRUTE FORCE DEFENSE
// ═══════════════════════════════════════════════
const requestCounts = new Map(); // key -> Array<timestamp>
const accountLockouts = new Map(); // phone -> unlockTimestamp

function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const timestamps = requestCounts.get(key) || [];
  const valid = timestamps.filter(t => now - t < windowMs);
  if (valid.length >= maxRequests) {
    requestCounts.set(key, valid);
    return true;
  }
  valid.push(now);
  requestCounts.set(key, valid);
  return false;
}

// Periodically clean up stale rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [k, times] of requestCounts.entries()) {
    const valid = times.filter(t => now - t < 15 * 60 * 1000);
    if (valid.length === 0) requestCounts.delete(k);
    else requestCounts.set(k, valid);
  }
  for (const [phone, unlockTime] of accountLockouts.entries()) {
    if (now > unlockTime) accountLockouts.delete(phone);
  }
}, 10 * 60 * 1000);

// Input Sanitization Helpers
function sanitizeText(str, maxLen = 100) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '') // strip potential HTML tags
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // strip control chars
    .trim()
    .slice(0, maxLen);
}

function isValidHttpUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════
//  VAPID & WEB PUSH SETUP
// ═══════════════════════════════════════════════
let vapidKeys;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
  };
} else if (fs.existsSync(VAPID_FILE)) {
  try {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
  } catch (e) {
    vapidKeys = webpush.generateVAPIDKeys();
    safeWriteJsonFile(VAPID_FILE, vapidKeys);
  }
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  safeWriteJsonFile(VAPID_FILE, vapidKeys);
}

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'saurabkumar@gmail.com'}`,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// phone -> Array<PushSubscription>
const pushSubscriptions = new Map();

function loadSubscriptions() {
  try {
    const data = safeReadJsonFile(SUBS_FILE, {});
    for (const [phone, subs] of Object.entries(data)) {
      pushSubscriptions.set(phone, subs);
    }
    console.log(`Loaded push subscriptions for ${pushSubscriptions.size} users.`);
  } catch (e) {
    console.error('Failed to load subscriptions:', e);
  }
}

function saveSubscriptionsLocal() {
  try {
    const obj = {};
    for (const [phone, subs] of pushSubscriptions.entries()) {
      obj[phone] = subs;
    }
    safeWriteJsonFile(SUBS_FILE, obj);
  } catch (e) {
    console.error('Failed to save subscriptions:', e);
  }
}

function saveSubscriptions() {
  saveSubscriptionsLocal();
  if (isMongoConnected && mongoDb) {
    const subsCol = mongoDb.collection('push_subscriptions');
    const ops = [];
    for (const [phone, subs] of pushSubscriptions.entries()) {
      ops.push({ replaceOne: { filter: { _id: phone }, replacement: { _id: phone, subs }, upsert: true } });
    }
    if (ops.length > 0) {
      subsCol.bulkWrite(ops).catch(err => console.error('MongoDB async saveSubscriptions error:', err.message));
    }
  }
}

loadSubscriptions();

function getSubscriptionsForPhone(targetPhone, excludePhone = null) {
  const seenEndpoints = new Set();
  const targets = [];
  const cleanExclude = excludePhone ? String(excludePhone).replace(/\D/g, '') : null;
  const last10Exclude = cleanExclude ? cleanExclude.slice(-10) : null;

  function isExcluded(phone) {
    if (!cleanExclude) return false;
    const cleanP = String(phone).replace(/\D/g, '');
    return cleanP === cleanExclude || (last10Exclude && last10Exclude.length >= 6 && cleanP.endsWith(last10Exclude)) || (cleanP.length >= 6 && cleanExclude.endsWith(cleanP.slice(-10)));
  }

  function addSub(phone, sub) {
    if (sub && sub.endpoint && !seenEndpoints.has(sub.endpoint)) {
      if (isExcluded(phone)) return;
      seenEndpoints.add(sub.endpoint);
      targets.push({ phone, sub });
    }
  }

  if (!targetPhone) {
    for (const [phone, subs] of pushSubscriptions.entries()) {
      if (!isExcluded(phone)) {
        for (const sub of subs) addSub(phone, sub);
      }
    }
    return targets;
  }

  const cleanTarget = String(targetPhone).replace(/\D/g, '');
  const last10 = cleanTarget.slice(-10);
  for (const [phone, subs] of pushSubscriptions.entries()) {
    if (isExcluded(phone)) continue;
    const cleanP = String(phone).replace(/\D/g, '');
    if (cleanP === cleanTarget || (last10.length >= 6 && cleanP.endsWith(last10)) || (cleanP.length >= 6 && cleanTarget.endsWith(cleanP.slice(-10)))) {
      for (const sub of subs) addSub(phone, sub);
    }
  }
  return targets;
}

async function sendWebPush(targetPhone, payload, excludePhone = null) {
  const payloadStr = JSON.stringify(payload);
  const targets = getSubscriptionsForPhone(targetPhone, excludePhone);

  console.log(`[WebPush] 📤 Dispatching push alert to ${targetPhone ? `user +${targetPhone}` : 'ALL other registered users'}${excludePhone ? ` (excluding sender +${excludePhone})` : ''} (${targets.length} target subscriptions found)...`);

  const removeList = [];
  let successCount = 0;
  for (const item of targets) {
    try {
      await webpush.sendNotification(item.sub, payloadStr, {
        TTL: 24 * 60 * 60,
        urgency: 'high'
      });
      successCount++;
      console.log(`[WebPush] ✅ Delivered push alert to +${item.phone} (endpoint: ${item.sub.endpoint.slice(0, 45)}...)`);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.warn(`[WebPush] ⚠️ Subscription expired for +${item.phone} (HTTP ${err.statusCode}). Marking for cleanup.`);
        removeList.push(item);
      } else {
        console.error(`[WebPush] ❌ Error delivering to +${item.phone}:`, err.statusCode || '', err.message);
      }
    }
  }

  if (removeList.length > 0) {
    for (const item of removeList) {
      const existing = pushSubscriptions.get(item.phone) || [];
      const filtered = existing.filter(s => s.endpoint !== item.sub.endpoint);
      if (filtered.length > 0) {
        pushSubscriptions.set(item.phone, filtered);
      } else {
        pushSubscriptions.delete(item.phone);
      }
    }
    saveSubscriptions();
  }

  return { total: targets.length, success: successCount, removed: removeList.length };
}

// ═══════════════════════════════════════════════
//  IN-MEMORY & PERSISTENT STORES
// ═══════════════════════════════════════════════
const otpStore = new Map();  // phone -> { otp, expiresAt, name, attempts }
const userStore = new Map();  // phone -> { phone, name, token, createdAt, color }
const tokenIndex = new Map();  // token -> phone
const rooms = new Map();  // roomCode -> room
const groups = new Map();  // groupId -> { id, code, name, description, hostPhone, hostName, members: [{phone, name, color, avatar, role}] }
const roomTimers = new Map();

const ROOM_TTL = 24 * 60 * 60 * 1000;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL = 5 * 60 * 1000;

function generateGroupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GRP-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function loadGroups() {
  try {
    const data = safeReadJsonFile(GROUPS_FILE, {});
    for (const [id, g] of Object.entries(data)) {
      groups.set(id, g);
    }
    console.log(`Loaded ${groups.size} persistent cricket groups.`);
  } catch (err) {
    console.error('Failed to load groups from disk:', err);
  }
}

function saveGroupsLocal() {
  try {
    const obj = {};
    for (const [id, g] of groups.entries()) {
      obj[id] = g;
    }
    safeWriteJsonFile(GROUPS_FILE, obj);
  } catch (err) {
    console.error('Failed to save groups to disk:', err);
  }
}

function saveGroups() {
  saveGroupsLocal();
  if (isMongoConnected && mongoDb) {
    const groupsCol = mongoDb.collection('groups');
    const ops = [];
    for (const [id, g] of groups.entries()) {
      ops.push({ replaceOne: { filter: { _id: id }, replacement: { _id: id, ...g }, upsert: true } });
    }
    if (ops.length > 0) {
      groupsCol.bulkWrite(ops).catch(err => console.error('MongoDB async saveGroups error:', err.message));
    }
  }
}

function getGroupsForPhone(phoneDigits) {
  if (!phoneDigits) return [];
  const clean = String(phoneDigits).replace(/\D/g, '');
  const result = [];
  for (const g of groups.values()) {
    const isMember = (g.members || []).some(m => phonesMatch(m.phone, clean));
    const isHost = phonesMatch(g.hostPhone, clean);
    if (isMember || isHost) {
      result.push(g);
    }
  }
  result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return result;
}

function loadUsers() {
  try {
    const data = safeReadJsonFile(USERS_FILE, {});
    for (const [phone, user] of Object.entries(data)) {
      userStore.set(phone, user);
      if (user.token) tokenIndex.set(user.token, phone);
    }
    console.log(`Loaded ${userStore.size} persistent users.`);
  } catch (err) {
    console.error('Failed to load users from disk:', err);
  }
}

function saveUsersLocal() {
  try {
    const obj = {};
    for (const [phone, user] of userStore.entries()) {
      obj[phone] = user;
    }
    safeWriteJsonFile(USERS_FILE, obj);
  } catch (err) {
    console.error('Failed to save users to disk:', err);
  }
}

function saveUsers() {
  saveUsersLocal();
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    const ops = [];
    for (const [phone, user] of userStore.entries()) {
      ops.push({ replaceOne: { filter: { _id: phone }, replacement: { _id: phone, ...user }, upsert: true } });
    }
    if (ops.length > 0) {
      usersCol.bulkWrite(ops).catch(err => console.error('MongoDB async saveUsers error:', err.message));
    }
  }
}

function loadRooms() {
  try {
    const data = safeReadJsonFile(ROOMS_FILE, {});
    for (const [code, r] of Object.entries(data)) {
      if (r.match?.teams) {
        if (Array.isArray(r.match.teams.team1?.players)) {
          r.match.teams.team1.players = r.match.teams.team1.players
            .map(p => (typeof p === 'string' ? p : (p?.name || p?.id || '')))
            .filter(Boolean);
        }
        if (Array.isArray(r.match.teams.team2?.players)) {
          r.match.teams.team2.players = r.match.teams.team2.players
            .map(p => (typeof p === 'string' ? p : (p?.name || p?.id || '')))
            .filter(Boolean);
        }
      }
      rooms.set(code, {
        ...r,
        sockets: {} // Sockets are runtime live connections
      });
      scheduleRoomExpiry(code);
    }
    console.log(`Loaded ${rooms.size} active persistent rooms.`);
  } catch (err) {
    console.error('Failed to load rooms from disk:', err);
  }
}

function saveRoomsLocal() {
  try {
    const obj = {};
    for (const [code, r] of rooms.entries()) {
      obj[code] = {
        code: r.code,
        matchName: r.matchName,
        hostPhone: r.hostPhone,
        groupId: r.groupId || null,
        planning: r.planning,
        match: r.match,
        createdAt: r.createdAt || Date.now()
      };
    }
    safeWriteJsonFile(ROOMS_FILE, obj);
  } catch (err) {
    console.error('Failed to save rooms to disk:', err);
  }
}

function saveRooms() {
  saveRoomsLocal();
  if (isMongoConnected && mongoDb) {
    const roomsCol = mongoDb.collection('rooms');
    const ops = [];
    for (const [code, r] of rooms.entries()) {
      const persistObj = {
        code: r.code,
        matchName: r.matchName,
        hostPhone: r.hostPhone,
        groupId: r.groupId || null,
        planning: r.planning,
        match: r.match,
        createdAt: r.createdAt || Date.now()
      };
      ops.push({ replaceOne: { filter: { _id: code }, replacement: { _id: code, ...persistObj }, upsert: true } });
    }
    if (ops.length > 0) {
      roomsCol.bulkWrite(ops).catch(err => console.error('MongoDB async saveRooms error:', err.message));
    }
  }
}

loadUsers();
loadRooms();
loadGroups();

// ── Web Push Endpoints ────────────────────────
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const { phone, subscription } = req.body;
  if (!phone || !subscription || !subscription.endpoint || typeof subscription.endpoint !== 'string') {
    return res.status(400).json({ error: 'Valid phone and push subscription required' });
  }

  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 8) return res.status(400).json({ error: 'Invalid phone number' });

  // Rate limit push subscriptions per phone
  if (isRateLimited(`push_sub:${cleaned}`, 10, 60 * 1000)) {
    return res.status(429).json({ error: 'Too many subscription requests' });
  }

  // Basic endpoint sanity check
  if (!isValidHttpUrl(subscription.endpoint)) {
    return res.status(400).json({ error: 'Invalid push endpoint URL' });
  }

  // Remove this device endpoint if it was previously registered to other phone numbers
  for (const [p, subs] of pushSubscriptions.entries()) {
    if (p !== cleaned) {
      const filtered = subs.filter(s => s.endpoint !== subscription.endpoint);
      if (filtered.length !== subs.length) {
        if (filtered.length > 0) pushSubscriptions.set(p, filtered);
        else pushSubscriptions.delete(p);
      }
    }
  }

  let existing = pushSubscriptions.get(cleaned) || [];
  if (!existing.some(s => s.endpoint === subscription.endpoint)) {
    existing.push(subscription);
    // Cap at max 5 active subscriptions per phone (drop oldest)
    if (existing.length > 5) existing = existing.slice(-5);
    pushSubscriptions.set(cleaned, existing);
    saveSubscriptions();
    console.log(`Registered Web Push subscription for phone +${cleaned}`);
  }
  res.json({ success: true });
});

app.post('/api/push/broadcast', async (req, res) => {
  const { message, author, token } = req.body;

  let senderName = sanitizeText(author || 'Cricket Player', 30);
  let senderPhone = null;
  if (token && tokenIndex.has(token)) {
    senderPhone = tokenIndex.get(token);
    const u = userStore.get(senderPhone);
    if (u?.name) senderName = sanitizeText(u.name, 30);
  }

  const cleanMessage = sanitizeText(message || `${senderName} is pinging everyone for a cricket match! Tap to open CricketHub.`, 140);

  const alertData = {
    id: Date.now(),
    title: '⚡ Cricket Match Alert!',
    message: cleanMessage,
    author: senderName,
    senderPhone: senderPhone || null,
    matchName: 'Cricket Match Alert',
    roomCode: null,
    isDirect: false,
    targetPhone: null,
    timestamp: Date.now()
  };

  if (senderPhone) {
    const cleanSender = String(senderPhone).replace(/\D/g, '');
    io.to('global:users').except(`user:${cleanSender}`).except(`user:${senderPhone}`).emit('popup:alert', alertData);
  } else {
    io.to('global:users').emit('popup:alert', alertData);
  }
  const result = await sendWebPush(null, alertData, senderPhone);
  res.json({ success: true, ...result });
});

app.get('/api/push/subscriptions-count', (req, res) => {
  let totalSubs = 0;
  for (const subs of pushSubscriptions.values()) totalSubs += subs.length;
  res.json({ users: pushSubscriptions.size, totalSubscriptions: totalSubs });
});

// ═══════════════════════════════════════════════
//  CRICKET GROUPS REST ENDPOINTS
// ═══════════════════════════════════════════════

app.get('/api/groups', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  let phone = req.query.phone;
  if (token && tokenIndex.has(token)) {
    phone = tokenIndex.get(token);
  }
  if (!phone) {
    return res.json({ groups: [] });
  }
  const userGroups = getGroupsForPhone(phone);
  res.json({ groups: userGroups });
});

app.get('/api/groups/:id', (req, res) => {
  const group = groups.get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json({ group });
});

app.post('/api/groups/create', (req, res) => {
  const { name, description, creatorPhone, creatorName, token } = req.body;
  let phone = creatorPhone;
  let uName = creatorName;
  if (token && tokenIndex.has(token)) {
    phone = tokenIndex.get(token);
    const u = userStore.get(phone);
    if (u?.name) uName = u.name;
  }
  if (!phone) return res.status(400).json({ error: 'Creator phone is required' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

  const cleanPhone = String(phone).replace(/\D/g, '');
  const id = 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const code = generateGroupCode();

  const creatorUser = findUserByPhone(cleanPhone) || { name: uName || 'Host', color: '#00e5ff', avatar: '🏏' };

  const group = {
    id,
    code,
    name: sanitizeText(name, 40),
    description: sanitizeText(description || '', 120),
    hostPhone: cleanPhone,
    hostName: sanitizeText(creatorUser.name || uName || 'Captain', 30),
    createdAt: Date.now(),
    members: [
      {
        phone: cleanPhone,
        name: sanitizeText(creatorUser.name || uName || 'Captain', 30),
        color: creatorUser.color || '#00e5ff',
        avatar: creatorUser.avatar || '🏏',
        role: 'captain',
        joinedAt: Date.now()
      }
    ]
  };

  groups.set(id, group);
  saveGroups();
  console.log(`[Groups] 🏏 Created group "${group.name}" (${group.code}) by +${cleanPhone}`);
  res.json({ success: true, group });
});

app.post('/api/groups/join', (req, res) => {
  const { code, phone, name, token } = req.body;
  let userPhone = phone;
  let userName = name;
  if (token && tokenIndex.has(token)) {
    userPhone = tokenIndex.get(token);
    const u = userStore.get(userPhone);
    if (u?.name) userName = u.name;
  }
  if (!userPhone) return res.status(400).json({ error: 'Phone number is required' });
  if (!code) return res.status(400).json({ error: 'Group invite code is required' });

  const cleanCode = String(code).trim().toUpperCase();
  const cleanPhone = String(userPhone).replace(/\D/g, '');

  let targetGroup = null;
  for (const g of groups.values()) {
    if (g.code && g.code.toUpperCase() === cleanCode) {
      targetGroup = g;
      break;
    }
  }

  if (!targetGroup) {
    return res.status(404).json({ error: 'Invalid group invite code' });
  }

  const existingIdx = (targetGroup.members || []).findIndex(m => phonesMatch(m.phone, cleanPhone));

  let user = findUserByPhone(cleanPhone);
  if (!user) {
    user = {
      phone: cleanPhone,
      name: sanitizeText(userName || 'Player', 30),
      color: COLORS[userStore.size % COLORS.length],
      avatar: null,
      role: 'member',
      createdAt: Date.now()
    };
    userStore.set(cleanPhone, user);
    saveUsers();
  }

  if (existingIdx === -1) {
    targetGroup.members.push({
      phone: cleanPhone,
      name: sanitizeText(user.name || userName || 'Player', 30),
      color: user.color || '#00e5ff',
      avatar: user.avatar || null,
      role: 'member',
      joinedAt: Date.now()
    });
    saveGroups();
    console.log(`[Groups] ➕ User +${cleanPhone} joined group "${targetGroup.name}" via code`);
  }

  res.json({ success: true, group: targetGroup });
});

app.post('/api/groups/:id/add-member', (req, res) => {
  const group = groups.get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const { name, phone, role } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'Name and phone are required' });

  const cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length < 8) return res.status(400).json({ error: 'Please enter a valid 10-digit phone number' });

  let user = findUserByPhone(cleanPhone);
  if (!user) {
    // Auto-register player on CricketHub app so they are searchable and persistent!
    user = {
      phone: cleanPhone,
      name: sanitizeText(name, 30),
      color: COLORS[userStore.size % COLORS.length],
      avatar: null,
      role: role || 'All-Rounder',
      createdAt: Date.now()
    };
    userStore.set(cleanPhone, user);
    saveUsers();
    console.log(`[Users] 🌟 Auto-registered new player "${user.name}" (+${cleanPhone}) in CricketHub directory`);
  } else if (name && (!user.name || user.name === 'Player')) {
    user.name = sanitizeText(name, 30);
    saveUsers();
  }

  const existingIdx = (group.members || []).findIndex(m => phonesMatch(m.phone, cleanPhone));
  const memberData = {
    phone: cleanPhone,
    name: sanitizeText(user.name || name, 30),
    color: user.color || COLORS[group.members.length % COLORS.length],
    avatar: user.avatar || null,
    role: role || user.role || 'All-Rounder',
    joinedAt: Date.now()
  };

  if (existingIdx >= 0) {
    group.members[existingIdx] = { ...group.members[existingIdx], ...memberData };
  } else {
    group.members.push(memberData);
  }

  saveGroups();

  // Auto-sync into all active rooms linked to this squad
  for (const [code, room] of rooms.entries()) {
    if (room.groupId === group.id && room.planning?.members) {
      if (!room.planning.members[cleanPhone]) {
        room.planning.members[cleanPhone] = {
          phone: cleanPhone,
          name: memberData.name,
          color: memberData.color,
          avatar: memberData.avatar,
          role: memberData.role,
          vote: null,
          votedAt: null
        };
      } else {
        room.planning.members[cleanPhone].name = memberData.name;
        room.planning.members[cleanPhone].avatar = memberData.avatar;
        room.planning.members[cleanPhone].color = memberData.color;
      }
      io.to(code).emit('planning:update', getRoomPublicState(room));
      io.to(code).emit('state:update', getRoomPublicState(room));
    }
  }

  res.json({ success: true, group, user });
});

app.post('/api/groups/:id/remove-member', (req, res) => {
  const group = groups.get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const { phone } = req.body;
  const cleanPhone = String(phone).replace(/\D/g, '');

  group.members = (group.members || []).filter(m => !phonesMatch(m.phone, cleanPhone));
  saveGroups();

  // Auto-remove from all active rooms linked to this squad
  for (const [code, room] of rooms.entries()) {
    if (room.groupId === group.id && room.planning?.members) {
      for (const pKey of Object.keys(room.planning.members)) {
        if (phonesMatch(pKey, cleanPhone)) {
          delete room.planning.members[pKey];
        }
      }
      io.to(code).emit('planning:update', getRoomPublicState(room));
      io.to(code).emit('state:update', getRoomPublicState(room));
    }
  }

  res.json({ success: true, group });
});

// ═══════════════════════════════════════════════
//  AUTH — OTP ENDPOINTS (LOGIN & SIGNUP)
// ═══════════════════════════════════════════════

function maskPhone(phone) {
  if (!phone) return '••••';
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length < 5) return '••••';
  const last3 = cleaned.slice(-3);
  return `+${cleaned.slice(0, cleaned.length > 10 ? 2 : 1)} ••••• ••${last3}`;
}

function findUserByPhone(phoneDigits) {
  if (!phoneDigits) return null;
  const cleaned = String(phoneDigits).replace(/\D/g, '');
  if (userStore.has(cleaned)) return userStore.get(cleaned);
  const last10 = cleaned.slice(-10);
  for (const [key, user] of userStore.entries()) {
    const kClean = String(key).replace(/\D/g, '');
    if (kClean === cleaned || (last10.length >= 7 && (kClean.endsWith(last10) || cleaned.endsWith(kClean.slice(-10))))) {
      return user;
    }
  }
  return null;
}

function findOtpRecord(phoneDigits) {
  if (!phoneDigits) return null;
  const cleaned = String(phoneDigits).replace(/\D/g, '');
  if (otpStore.has(cleaned)) return { key: cleaned, record: otpStore.get(cleaned) };
  const last10 = cleaned.slice(-10);
  for (const [key, rec] of otpStore.entries()) {
    const kClean = String(key).replace(/\D/g, '');
    if (kClean === cleaned || (last10.length >= 7 && (kClean.endsWith(last10) || cleaned.endsWith(kClean.slice(-10))))) {
      return { key, record: rec };
    }
  }
  return null;
}

function findUserByToken(token) {
  if (!token) return null;
  if (tokenIndex.has(token)) {
    const phone = tokenIndex.get(token);
    const u = userStore.get(phone) || findUserByPhone(phone);
    if (u) return u;
  }
  for (const [phoneKey, u] of userStore.entries()) {
    if (u && u.token === token) {
      tokenIndex.set(token, u.phone || phoneKey);
      return u;
    }
  }
  return null;
}

// Request OTP for Login or Signup
app.post('/api/auth/request-otp', (req, res) => {
  const { phone, name, mode } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 8) return res.status(400).json({ error: 'Please enter a valid 10-digit phone number' });

  const existingUser = findUserByPhone(cleaned);

  // If in login mode and account does not exist
  if (mode === 'login' && !existingUser) {
    return res.status(404).json({
      error: 'No registered player found with this number. Please switch to Sign Up to create your account!',
      notFound: true
    });
  }

  // If in signup mode and user already exists
  if (mode === 'signup' && existingUser) {
    return res.status(409).json({
      error: `An account already exists for this number (${existingUser.name || 'Player'}). Please log in instead!`,
      alreadyExists: true,
      existingName: existingUser.name
    });
  }

  // If in signup mode, player name is required for new registration
  const sanitizedName = sanitizeText(name || '', 30);
  if (mode === 'signup' && !sanitizedName) {
    return res.status(400).json({ error: 'Player Name is required to Sign Up' });
  }

  const finalName = sanitizedName || (existingUser && existingUser.name) || 'Player';

  // Cryptographically secure random 6-digit OTP
  const otp = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = Date.now() + OTP_TTL;

  otpStore.set(cleaned, {
    otp,
    expiresAt,
    name: finalName,
    attempts: 0,
    isNew: !existingUser,
    existingKey: existingUser?.phone
  });

  console.log(`\n🔐 OTP for +${cleaned} (${finalName}) [${mode || 'auth'}]: [ ${otp} ]  — expires in 5 min\n`);

  res.json({
    success: true,
    devOtp: otp,
    isNew: !existingUser,
    name: finalName,
    maskedPhone: maskPhone(cleaned)
  });
});

// Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

  const cleaned = phone.replace(/\D/g, '');
  const otpMatch = findOtpRecord(phone);

  if (!otpMatch) return res.status(400).json({ error: 'No active OTP requested for this number. Please tap "Resend OTP" or "Send OTP".' });
  
  const { key: recordKey, record } = otpMatch;
  if (Date.now() > record.expiresAt) {
    otpStore.delete(recordKey);
    return res.status(400).json({ error: 'OTP has expired. Please click Resend OTP for a new code.', expired: true });
  }

  if (record.otp !== otp.trim()) {
    return res.status(400).json({
      error: 'Incorrect OTP code. Please check the code or tap Resend OTP.'
    });
  }

  // OTP verified successfully
  otpStore.delete(recordKey);

  // Create or update user
  let user = findUserByPhone(cleaned) || findUserByPhone(recordKey);
  const userKey = user?.phone || cleaned;
  const token = crypto.randomBytes(32).toString('hex');

  if (user) {
    if (tokenIndex.has(user.token)) tokenIndex.delete(user.token);
    if (record.name && record.name !== 'Player') user.name = record.name;
    user.token = token;
    user.createdAt = user.createdAt || Date.now();
  } else {
    user = {
      phone: cleaned,
      name: record.name || 'Player',
      token,
      avatar: null,
      createdAt: Date.now(),
      color: COLORS[userStore.size % COLORS.length]
    };
  }

  userStore.set(cleaned, user);
  tokenIndex.set(token, cleaned);
  saveUsers();

  // Set persistent cookie for iOS Safari & PWA standalone sync
  res.setHeader('Set-Cookie', `crickethub_token=${token}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`);

  res.json({
    success: true,
    token,
    user: {
      phone: cleaned,
      name: user.name,
      color: user.color,
      avatar: user.avatar,
      createdAt: user.createdAt
    }
  });
});

// Validate session token
app.post('/api/auth/me', (req, res) => {
  const cookieMatch = req.headers.cookie && req.headers.cookie.match(/(^|;\s*)crickethub_token=([^;]*)/);
  const cookieToken = cookieMatch ? decodeURIComponent(cookieMatch[2]) : null;
  const token = req.body?.token || req.headers['authorization']?.replace('Bearer ', '') || cookieToken;
  if (!token) return res.status(401).json({ error: 'No token' });

  const user = findUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired session' });

  user.createdAt = user.createdAt || Date.now();
  res.json({
    success: true,
    user: {
      phone: user.phone,
      name: user.name,
      color: user.color,
      avatar: user.avatar,
      createdAt: user.createdAt
    }
  });
});

// ═══════════════════════════════════════════════
//  ROOM HELPERS
// ═══════════════════════════════════════════════
const COLORS = [
  '#00E5FF', '#FF6B35', '#7C4DFF', '#00E676', '#FF4081',
  '#FFD740', '#69F0AE', '#40C4FF', '#FF6E40', '#EEFF41'
];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'CRK-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(matchName, hostPhone) {
  const code = generateRoomCode();
  const hostUser = userStore.get(hostPhone);
  const room = {
    code,
    matchName,
    createdAt: Date.now(),
    hostPhone,
    // Planning / RSVP state
    planning: {
      members: {},  // phone -> { phone, name, color, vote, comment, joinedAt }
    },
    // Match state
    match: {
      status: 'planning',
      date: '',
      time: '',
      teams: {
        team1: { name: 'Team 1', players: [] },
        team2: { name: 'Team 2', players: [] }
      },
      overs: 20,
      toss: null,
      battingFirst: null,
      location: { text: '', mapUrl: '' },
      innings: [createInnings(), createInnings()],
      currentInnings: 0,
      announcements: [],
      chat: []
    },
    // Connected socket -> phone mapping
    sockets: {}
  };

  // Add host to planning members
  if (hostUser) {
    room.planning.members[hostPhone] = {
      phone: hostPhone,
      name: hostUser.name,
      color: hostUser.color,
      vote: null,        // 'coming' | 'not_coming' | 'maybe'
      comment: '',
      isHost: true,
      joinedAt: Date.now()
    };
  }

  rooms.set(code, room);
  scheduleRoomExpiry(code);
  return room;
}

function createInnings() {
  return {
    battingTeam: null, bowlingTeam: null,
    runs: 0, wickets: 0, overs: 0, balls: 0,
    extras: { wide: 0, noBall: 0, bye: 0, legBye: 0 },
    batsmen: [], bowlers: [],
    currentBatsmen: [null, null], currentBowler: null,
    ballLog: [], currentOver: [],
    target: null, completed: false,
    awaitingNewBowler: false,   // true after each over ends
    awaitingNewBatsman: false,  // true after a wicket falls
    dismissedBatsmanIdx: null,  // index of batsman who was just dismissed
    isSingleBatter: false,      // true if playing in single batter (solo) mode
    lastBowlerIdx: null,        // index of bowler who just finished the over
    // Undo / Redo history stacks (stored as deep-clone snapshots)
    _history: [],   // stack of past innings states (before each ball)
    _redoStack: []  // stack of undone states (for redo)
  };
}

// Deep-clone innings state for history (strip internal stacks to avoid bloat)
function snapshotInnings(inn) {
  const { _history, _redoStack, ...rest } = inn;
  return JSON.parse(JSON.stringify(rest));
}

// Restore a snapshot back onto the live innings object
function restoreInnings(inn, snapshot) {
  const history = inn._history;
  const redoStack = inn._redoStack;
  Object.assign(inn, JSON.parse(JSON.stringify(snapshot)));
  inn._history = history;
  inn._redoStack = redoStack;
}

function scheduleRoomExpiry(code) {
  if (roomTimers.has(code)) clearTimeout(roomTimers.get(code));
  const timer = setTimeout(() => {
    rooms.delete(code);
    roomTimers.delete(code);
    io.to(code).emit('room:expired');
  }, ROOM_TTL);
  roomTimers.set(code, timer);
}

function getRoomPublicState(room) {
  // Strip internal history stacks from public state to keep payload small
  const match = JSON.parse(JSON.stringify(room.match));
  match.innings.forEach(inn => {
    delete inn._history;
    delete inn._redoStack;
  });
  // Attach canUndo/canRedo per innings correctly
  room.match.innings.forEach((liveInn, i) => {
    match.innings[i].canUndo = liveInn._history.length > 0;
    match.innings[i].canRedo = liveInn._redoStack.length > 0;
  });

  if (match.status === 'completed') {
    match.result = calculateMatchResult(match);
  }

  const onlineList = Object.values(room.sockets || {}).filter(Boolean);
  const isHostOnline = onlineList.some(op => phonesMatch(op, room.hostPhone));
  const planning = JSON.parse(JSON.stringify(room.planning));
  Object.keys(planning.members).forEach(phone => {
    const isThisMemberHost = !!(planning.members[phone].isHost || phonesMatch(room.hostPhone, phone));
    planning.members[phone].isHost = isThisMemberHost;
    planning.members[phone].isOnline = isThisMemberHost
      ? isHostOnline
      : onlineList.some(op => phonesMatch(op, phone));
  });

  let groupDetails = null;
  if (room.groupId && groups.has(room.groupId)) {
    const g = groups.get(room.groupId);
    groupDetails = {
      id: g.id,
      code: g.code,
      name: g.name,
      members: g.members
    };
  }

  return {
    code: room.code,
    matchName: room.matchName,
    hostPhone: room.hostPhone,
    groupId: room.groupId || null,
    groupName: room.groupName || (groupDetails ? groupDetails.name : null),
    group: groupDetails,
    planning,
    onlineCount: onlineList.length,
    match
  };
}

function getPlanningStats(room) {
  const members = Object.values(room.planning.members);
  return {
    total: members.length,
    coming: members.filter(m => m.vote === 'coming').length,
    notComing: members.filter(m => m.vote === 'not_coming').length,
    maybe: members.filter(m => m.vote === 'maybe').length,
    noVote: members.filter(m => m.vote === null).length
  };
}

function checkAllBattersOut(match, inn) {
  if (!match || !inn || !inn.batsmen) return false;
  const battingTeamPlayers = (match.teams?.[inn.battingTeam]?.players || []);
  const teamPlayerNames = battingTeamPlayers.map(p => (typeof p === 'string' ? p : (p?.name || p?.id || ''))).filter(Boolean);
  const outNames = new Set((inn.batsmen || []).filter(b => b.out).map(b => b.name.toLowerCase().trim()));

  const nonStrikerIdx = inn.currentBatsmen?.[1];
  const strikerIdx = inn.currentBatsmen?.[0];
  const hasSurvivingNonStriker = nonStrikerIdx !== null && nonStrikerIdx !== undefined && inn.batsmen?.[nonStrikerIdx] && !inn.batsmen[nonStrikerIdx].out;
  const hasSurvivingStriker = strikerIdx !== null && strikerIdx !== undefined && inn.batsmen?.[strikerIdx] && !inn.batsmen[strikerIdx].out;
  const hasSurvivingBatter = hasSurvivingNonStriker || hasSurvivingStriker;

  const currentCreaseNames = new Set(
    (inn.currentBatsmen || [])
      .map(i => (i !== null && i !== undefined && inn.batsmen[i]) ? inn.batsmen[i].name.toLowerCase().trim() : null)
      .filter(Boolean)
  );
  const benchAvailable = teamPlayerNames.filter(p => !outNames.has(p.toLowerCase().trim()) && !currentCreaseNames.has(p.toLowerCase().trim()));

  const teamSize = teamPlayerNames.length;
  const outCount = (inn.batsmen || []).filter(b => b.out).length;

  if (teamSize > 0 && outCount >= teamSize) return true;
  if (!hasSurvivingBatter && benchAvailable.length === 0 && inn.batsmen.length > 0) return true;

  return false;
}

// ═══════════════════════════════════════════════
//  MATCH HISTORY HELPERS & PERSISTENCE
// ═══════════════════════════════════════════════
function calculateMatchResult(match) {
  if (!match) return { winner: null, summary: 'No match data' };

  // Super Over result calculation
  if (match.isSuperOver && match.innings?.length >= 4) {
    const so1 = match.innings[2];
    const so2 = match.innings[3];
    const so1TeamName = match.teams?.[so1?.battingTeam]?.name || 'Team 1';
    const so2TeamName = match.teams?.[so2?.battingTeam]?.name || 'Team 2';

    if (match.status !== 'completed') {
      return { winner: null, summary: '⚡ Super Over Shootout in Progress' };
    }

    if (so2 && so2.target !== null && so2.runs >= so2.target) {
      const w = Math.max(0, 2 - so2.wickets);
      return {
        winner: so2.battingTeam,
        winnerName: so2TeamName,
        summary: `⚡ ${so2TeamName} won via Super Over by ${w} wicket${w !== 1 ? 's' : ''}! 🏆`
      };
    } else if (so2 && so2.completed) {
      if (so1.runs > so2.runs) {
        const d = so1.runs - so2.runs;
        return {
          winner: so1.battingTeam,
          winnerName: so1TeamName,
          summary: `⚡ ${so1TeamName} won via Super Over by ${d} run${d !== 1 ? 's' : ''}! 🏆`
        };
      } else {
        return {
          winner: 'tie',
          winnerName: 'Tie',
          summary: `⚡ Super Over Tied (${so1.runs} - ${so2.runs})`
        };
      }
    }
  }

  const inn1 = match.innings?.[0];
  const inn2 = match.innings?.[1];
  const t1Name = match.teams?.[inn1?.battingTeam]?.name || (inn1?.battingTeam === 'team1' ? 'Team 1' : 'Team 2');
  const t2Name = match.teams?.[inn2?.battingTeam]?.name || (inn2?.battingTeam === 'team1' ? 'Team 1' : 'Team 2');

  if (match.status !== 'completed') {
    return { winner: null, summary: 'In Progress' };
  }

  if (inn2 && inn2.target !== null && inn2.runs >= inn2.target) {
    const w = Math.max(1, 10 - inn2.wickets);
    return {
      winner: inn2.battingTeam,
      winnerName: t2Name,
      summary: `${t2Name} won by ${w} wicket${w !== 1 ? 's' : ''}`
    };
  } else if (inn1 && inn2) {
    if (inn1.runs > inn2.runs) {
      const d = inn1.runs - inn2.runs;
      return {
        winner: inn1.battingTeam,
        winnerName: t1Name,
        summary: `${t1Name} won by ${d} run${d !== 1 ? 's' : ''}`
      };
    } else if (inn2.runs > inn1.runs) {
      const w = Math.max(1, 10 - inn2.wickets);
      return {
        winner: inn2.battingTeam,
        winnerName: t2Name,
        summary: `${t2Name} won by ${w} wicket${w !== 1 ? 's' : ''}`
      };
    } else {
      return {
        winner: 'tie',
        winnerName: 'Tie',
        summary: `Match Tied (${inn1.runs} - ${inn2.runs})`
      };
    }
  }
  return {
    winner: null,
    summary: 'Match Completed'
  };
}

function saveMatchToHistory(room) {
  try {
    if (!room || !room.match) return null;
    const match = room.match;
    // Only save if some scoring or toss happened
    const hasScoring = match.innings && match.innings.some(inn => (inn.balls > 0 || inn.runs > 0 || inn.wickets > 0));
    if (!hasScoring && match.status === 'planning') return null;

    const id = `${room.code}-${Date.now()}`;
    const result = calculateMatchResult(match);

    // Clean innings for storage (strip internal stacks)
    const cleanInnings = (match.innings || []).map(inn => {
      const { _history, _redoStack, ...rest } = inn;
      return rest;
    });

    const record = {
      id,
      code: room.code,
      matchName: room.matchName || 'Cricket Match',
      hostPhone: room.hostPhone,
      savedAt: Date.now(),
      status: match.status,
      result,
      teams: match.teams,
      overs: match.overs,
      toss: match.toss,
      battingFirst: match.battingFirst,
      location: match.location,
      innings: cleanInnings,
      announcements: match.announcements || []
    };

    const filePath = path.join(MATCHES_DIR, `${id}.json`);
    safeWriteJsonFile(filePath, record);
    console.log(`💾 Saved match history: ${filePath}`);

    if (isMongoConnected && mongoDb) {
      mongoDb.collection('matches')
        .replaceOne({ _id: id }, { _id: id, ...record }, { upsert: true })
        .then(() => console.log(`☁️ Synced match ${id} to MongoDB Cloud.`))
        .catch(err => console.error('MongoDB async saveMatch error:', err.message));
    }
    return record;
  } catch (err) {
    console.error('Error saving match history:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════
//  REST — Room lookup & History & Player Profiles
// ═══════════════════════════════════════════════
function getAllMatchesMap() {
  const matchMap = new Map();

  // 1. Load from disk (completed/archived matches)
  if (fs.existsSync(MATCHES_DIR)) {
    const files = fs.readdirSync(MATCHES_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(MATCHES_DIR, f), 'utf-8');
        const data = JSON.parse(raw);
        if (data) {
          const matchCode = data.code || (data.id ? data.id.split('-').slice(0, 2).join('-') : null);
          const hasBalls = data.innings && data.innings.some(inn => (inn.balls > 0 || inn.runs > 0 || inn.wickets > 0));
          if (matchCode && (data.status === 'completed' || hasBalls)) {
            const existing = matchMap.get(matchCode);
            if (!existing || (data.savedAt || 0) >= (existing.savedAt || 0)) {
              matchMap.set(matchCode, data);
            }
          }
        }
      } catch (e) { }
    }
  }

  // 2. Load active played rooms from memory (must have actual balls bowled or be completed)
  for (const [code, room] of rooms.entries()) {
    if (room && room.match) {
      const match = room.match;
      const hasBalls = match.innings && match.innings.some(inn => inn.balls > 0);
      const isCompleted = match.status === 'completed';
      if (hasBalls || isCompleted) {
        const cleanInnings = (match.innings || []).map(inn => {
          const { _history, _redoStack, ...rest } = inn;
          return rest;
        });
        const activeRecord = {
          id: `${code}-live`,
          code: code,
          matchName: room.matchName || 'Cricket Match',
          hostPhone: room.hostPhone,
          savedAt: Date.now(),
          status: match.status,
          result: calculateMatchResult(match),
          teams: match.teams,
          overs: match.overs,
          toss: match.toss,
          battingFirst: match.battingFirst,
          location: match.location,
          innings: cleanInnings,
          planningMembers: Object.values(room.planning?.members || {})
        };
        const existing = matchMap.get(code);
        if (!existing || isCompleted || (activeRecord.savedAt >= (existing.savedAt || 0))) {
          matchMap.set(code, activeRecord);
        }
      }
    }
  }

  return Array.from(matchMap.values()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

function phonesMatch(p1, p2) {
  if (!p1 || !p2) return false;
  if (p1 === p2) return true;
  const d1 = String(p1).replace(/\D/g, '');
  const d2 = String(p2).replace(/\D/g, '');
  if (!d1 || !d2) return false;
  if (d1 === d2) return true;
  if (d1.endsWith(d2) || d2.endsWith(d1)) return true;
  const minLen = Math.min(d1.length, d2.length, 10);
  if (minLen >= 6) {
    return d1.slice(-minLen) === d2.slice(-minLen);
  }
  return false;
}

function getPlayerProfile(identifier) {
  if (!identifier) return null;
  const cleanId = String(identifier).trim();
  const digitsOnly = cleanId.replace(/\D/g, '');

  // 1. Find user in userStore
  let user = null;
  if (digitsOnly && userStore.has(digitsOnly)) {
    user = userStore.get(digitsOnly);
  } else {
    for (const [phone, u] of userStore.entries()) {
      if (phonesMatch(phone, cleanId) || phonesMatch(phone, digitsOnly)) {
        user = u;
        break;
      }
      if (u.name && u.name.trim().toLowerCase() === cleanId.toLowerCase() && !['player', 'captain', 'user'].includes(u.name.trim().toLowerCase())) {
        user = u;
        break;
      }
    }
  }

  const playerName = user?.name || cleanId;
  const playerPhone = user?.phone || (digitsOnly.length >= 7 ? digitsOnly : null);
  const playerColor = user?.color || '#00E5FF';
  const memberSince = user?.createdAt || null;
  const isGenericName = ['player', 'player 1', 'player 2', 'player 3', 'captain', 'user', 'batter', 'bowler', ''].includes(playerName.trim().toLowerCase());

  // 2. Scan all deduplicated matches
  const allMatches = getAllMatchesMap();
  const playerMatches = [];

  let totalRuns = 0;
  let totalBalls = 0;
  let totalFours = 0;
  let totalSixes = 0;
  let battingInnings = 0;
  let notOutCount = 0;
  let ducksCount = 0;
  let highestRuns = 0;
  let highestIsOut = true;
  let fifties = 0;
  let hundreds = 0;

  let bowlingInnings = 0;
  let totalBallsBowled = 0;
  let totalMaidens = 0;
  let totalRunsConceded = 0;
  let totalWickets = 0;
  let bestWickets = 0;
  let bestRunsConceded = 999;

  for (const match of allMatches) {
    // Check if player is an authenticated/recognized participant in this match
    const isHost = !!(playerPhone && phonesMatch(match.hostPhone, playerPhone));
    const planningMember = (match.planningMembers || []).find(m => {
      if (!m) return false;
      if (playerPhone && phonesMatch(m.phone, playerPhone)) return true;
      if (!playerPhone && !isGenericName && m.name && m.name.trim().toLowerCase() === playerName.trim().toLowerCase()) return true;
      return false;
    });

    const teamPlayer = (() => {
      const allPlayers = [
        ...(match.teams?.team1?.players || []),
        ...(match.teams?.team2?.players || [])
      ];
      return allPlayers.find(p => {
        if (!p) return false;
        if (playerPhone && (phonesMatch(p.phone, playerPhone) || phonesMatch(p.id, playerPhone))) return true;
        if (!playerPhone && !isGenericName && p.name && p.name.trim().toLowerCase() === playerName.trim().toLowerCase()) return true;
        return false;
      });
    })();

    const isMatchParticipant = !!(isHost || planningMember || teamPlayer);

    // If player has a phone or generic name and is NOT verified to be part of this match, skip this match completely!
    if (!isMatchParticipant) {
      if (playerPhone || isGenericName) {
        continue;
      }
    }

    // Determine the name used by this player in this match's scorecards
    const matchAlias = (planningMember?.name || teamPlayer?.name || playerName).trim().toLowerCase();

    let playedInMatch = false;
    let matchBatting = null;
    let matchBowling = null;

    const inningsList = match.innings || [];
    for (const inn of inningsList) {
      // Batsman check
      const batsmen = inn.batsmen || [];
      const foundBat = batsmen.find(b => {
        if (!b || !b.name) return false;
        const bName = b.name.trim().toLowerCase();
        if (b.phone && playerPhone && phonesMatch(b.phone, playerPhone)) return true;
        if (b.id && playerPhone && (b.id === playerPhone || (user && b.id === user.token))) return true;
        if (isMatchParticipant) {
          return bName === matchAlias || (user && bName === user.name.trim().toLowerCase());
        }
        return !isGenericName && bName === playerName.trim().toLowerCase();
      });

      if (foundBat) {
        playedInMatch = true;
        const bRuns = Number(foundBat.runs || 0);
        const bBalls = Number(foundBat.balls || 0);
        const bFours = Number(foundBat.fours || 0);
        const bSixes = Number(foundBat.sixes || 0);
        const isOut = !!foundBat.out;
        const dismissal = foundBat.dismissal || (isOut ? 'out' : 'not out');
        const sr = bBalls > 0 ? ((bRuns / bBalls) * 100).toFixed(1) : '0.0';

        // Only count as batting innings if they faced balls or scored runs or got out
        if (bBalls > 0 || bRuns > 0 || isOut) {
          matchBatting = {
            didBat: true,
            runs: bRuns,
            balls: bBalls,
            fours: bFours,
            sixes: bSixes,
            out: isOut,
            dismissal,
            strikeRate: sr
          };

          battingInnings++;
          totalRuns += bRuns;
          totalBalls += bBalls;
          totalFours += bFours;
          totalSixes += bSixes;
          if (!isOut) notOutCount++;
          if (isOut && bRuns === 0 && bBalls > 0) ducksCount++;

          if (bRuns >= 100) hundreds++;
          else if (bRuns >= 50) fifties++;

          if (bRuns > highestRuns || (bRuns === highestRuns && !isOut)) {
            highestRuns = bRuns;
            highestIsOut = isOut;
          }
        }
      }

      // Bowler check
      const bowlers = inn.bowlers || [];
      const foundBowl = bowlers.find(b => {
        if (!b || !b.name) return false;
        const bName = b.name.trim().toLowerCase();
        if (b.phone && playerPhone && phonesMatch(b.phone, playerPhone)) return true;
        if (b.id && playerPhone && (b.id === playerPhone || (user && b.id === user.token))) return true;
        if (isMatchParticipant) {
          return bName === matchAlias || (user && bName === user.name.trim().toLowerCase());
        }
        return !isGenericName && bName === playerName.trim().toLowerCase();
      });

      if (foundBowl) {
        playedInMatch = true;
        const bOvers = Number(foundBowl.overs || 0);
        const wholeOvers = Math.floor(bOvers);
        const partBalls = Math.round((bOvers - wholeOvers) * 10);
        const matchBalls = (wholeOvers * 6) + partBalls;

        const bMaidens = Number(foundBowl.maidens || 0);
        const bRuns = Number(foundBowl.runs || 0);
        const bWickets = Number(foundBowl.wickets || 0);
        const econ = matchBalls > 0 ? ((bRuns / (matchBalls / 6))).toFixed(2) : (bOvers > 0 ? (bRuns / bOvers).toFixed(2) : '0.00');

        if (matchBalls > 0 || bRuns > 0 || bWickets > 0) {
          matchBowling = {
            didBowl: true,
            overs: bOvers,
            oversFormatted: bOvers.toString(),
            maidens: bMaidens,
            runs: bRuns,
            wickets: bWickets,
            economy: econ
          };

          bowlingInnings++;
          totalBallsBowled += matchBalls;
          totalMaidens += bMaidens;
          totalRunsConceded += bRuns;
          totalWickets += bWickets;

          if (bWickets > bestWickets || (bWickets === bestWickets && bRuns < bestRunsConceded)) {
            bestWickets = bWickets;
            bestRunsConceded = bRuns;
          }
        }
      }
    }

    if (isMatchParticipant) {
      playedInMatch = true;
    }

    if (playedInMatch) {
      playerMatches.push({
        matchId: match.id,
        code: match.code,
        matchName: match.matchName,
        teams: match.teams,
        overs: match.overs,
        status: match.status,
        result: match.result,
        location: match.location,
        savedAt: match.savedAt || Date.now(),
        batting: matchBatting,
        bowling: matchBowling
      });
    }
  }

  // Calculate averages
  const dismissals = battingInnings - notOutCount;
  const battingAverage = dismissals > 0 ? (totalRuns / dismissals).toFixed(2) : (totalRuns > 0 ? `${totalRuns}.00*` : '0.00');
  const battingStrikeRate = totalBalls > 0 ? ((totalRuns / totalBalls) * 100).toFixed(2) : '0.00';
  const highestScoreStr = battingInnings > 0 ? `${highestRuns}${highestIsOut ? '' : '*'}` : '0';

  const bowlingTotalOvers = `${Math.floor(totalBallsBowled / 6)}.${totalBallsBowled % 6}`;
  const bowlingEconomy = totalBallsBowled > 0 ? ((totalRunsConceded / (totalBallsBowled / 6))).toFixed(2) : '0.00';
  const bowlingAverage = totalWickets > 0 ? (totalRunsConceded / totalWickets).toFixed(2) : (totalRunsConceded > 0 ? `${totalRunsConceded}.00` : '0.00');
  const bestBowlingStr = bowlingInnings > 0 ? `${bestWickets}/${bestRunsConceded === 999 ? 0 : bestRunsConceded}` : '—';

  // Group matches by Date (e.g. "Today - Sep 4, 2026")
  const dateGroupsMap = new Map();
  for (const m of playerMatches) {
    const d = new Date(m.savedAt);
    const dateKey = d.toISOString().split('T')[0];
    const dateHeading = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    if (!dateGroupsMap.has(dateKey)) {
      dateGroupsMap.set(dateKey, {
        dateKey,
        dateHeading,
        timestamp: d.getTime(),
        matches: []
      });
    }
    dateGroupsMap.get(dateKey).matches.push(m);
  }

  const matchesByDate = Array.from(dateGroupsMap.values()).sort((a, b) => b.timestamp - a.timestamp);

  return {
    player: {
      name: playerName,
      phone: playerPhone,
      rawPhone: playerPhone,
      color: playerColor,
      avatar: user?.avatar || null,
      memberSince: memberSince ? new Date(memberSince).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
      createdAt: memberSince || Date.now(),
      totalMatches: playerMatches.length
    },
    stats: {
      batting: {
        innings: battingInnings,
        runs: totalRuns,
        balls: totalBalls,
        fours: totalFours,
        sixes: totalSixes,
        highestScore: highestScoreStr,
        average: battingAverage,
        strikeRate: battingStrikeRate,
        fifties,
        hundreds,
        notOuts: notOutCount,
        ducks: ducksCount
      },
      bowling: {
        innings: bowlingInnings,
        overs: bowlingTotalOvers,
        maidens: totalMaidens,
        runsConceded: totalRunsConceded,
        wickets: totalWickets,
        bestBowling: bestBowlingStr,
        economy: bowlingEconomy,
        average: bowlingAverage
      }
    },
    matchesByDate,
    recentMatches: playerMatches
  };
}

app.get('/api/players', (req, res) => {
  try {
    const list = [];
    const seenNames = new Set();

    for (const [phone, u] of userStore.entries()) {
      if (u && u.name) {
        const prof = getPlayerProfile(phone);
        list.push({
          id: u.name,
          name: u.name,
          phoneMasked: maskPhone(u.phone || phone),
          color: u.color || '#00E5FF',
          avatar: u.avatar || null,
          totalMatches: prof?.player?.totalMatches || 0,
          totalRuns: prof?.stats?.batting?.runs || 0,
          totalWickets: prof?.stats?.bowling?.wickets || 0
        });
        seenNames.add(u.name.toLowerCase());
      }
    }

    list.sort((a, b) => (b.totalMatches - a.totalMatches) || b.totalRuns - a.totalRuns);
    res.json({ players: list });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list players' });
  }
});

app.get('/api/profile/:id', (req, res) => {
  try {
    const prof = getPlayerProfile(req.params.id);
    if (!prof) return res.status(404).json({ error: 'Player profile not found' });

    // Authenticate requester if token provided
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '') || req.query.token;
    const reqPhone = token ? tokenIndex.get(token) : null;

    const targetPhone = prof.user?.rawPhone || prof.player?.rawPhone || prof.user?.phone || prof.player?.phone;
    const reqDigits = (reqPhone || '').replace(/\D/g, '');
    const targetDigits = (targetPhone || '').replace(/\D/g, '');
    const isMe = !!(reqDigits && targetDigits && (reqDigits === targetDigits || (reqDigits.length >= 7 && targetDigits.length >= 7 && (reqDigits.endsWith(targetDigits.slice(-10)) || targetDigits.endsWith(reqDigits.slice(-10))))));

    prof.isMe = isMe;

    // Strict Privacy: If viewing someone else's profile, mask their phone number!
    if (!isMe) {
      if (prof.user) {
        prof.user.phone = maskPhone(prof.user.phone);
        delete prof.user.rawPhone;
      }
      if (prof.player) {
        prof.player.phone = maskPhone(prof.player.phone);
        delete prof.player.rawPhone;
      }
    }

    res.json(prof);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load player profile' });
  }
});

app.post('/api/profile/avatar', (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '') || req.body.token;
    const authPhone = token ? tokenIndex.get(token) : null;

    const { phone, avatar } = req.body;
    const targetDigits = (phone || '').replace(/\D/g, '');

    // Privacy security: Verify token belongs to user being edited
    if (authPhone && targetDigits && authPhone !== targetDigits) {
      return res.status(403).json({ error: 'Unauthorized: You can only edit your own profile photo' });
    }

    const effectivePhone = authPhone || targetDigits;
    if (!effectivePhone) return res.status(400).json({ error: 'Phone number or token is required' });

    let user = userStore.get(effectivePhone);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.avatar = avatar || null; // base64 data URL or null to remove
    userStore.set(user.phone || effectivePhone, user);
    saveUsers();

    // Update in any active planning room members
    for (const room of rooms.values()) {
      if (room.planning?.members) {
        for (const [mPhone, m] of Object.entries(room.planning.members)) {
          if (mPhone === user.phone || mPhone === effectivePhone || (m.phone && m.phone === user.phone)) {
            m.avatar = user.avatar;
          }
        }
      }
    }

    console.log(`Updated avatar for player ${user.name} (${user.phone})`);
    res.json({ success: true, avatar: user.avatar });
  } catch (err) {
    console.error('Failed to update avatar:', err);
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    exists: true,
    matchName: room.matchName,
    memberCount: Object.keys(room.planning.members).length,
    stats: getPlanningStats(room)
  });
});

// Complete Database Reset Endpoint (Wipes local and MongoDB cloud data)
app.all('/api/admin/clean-all-data', async (req, res) => {
  try {
    userStore.clear();
    tokenIndex.clear();
    rooms.clear();
    groups.clear();
    pushSubscriptions.clear();
    saveUsersLocal();
    saveRoomsLocal();
    saveGroupsLocal();
    saveSubscriptionsLocal();

    if (fs.existsSync(MATCHES_DIR)) {
      const files = fs.readdirSync(MATCHES_DIR).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try { fs.unlinkSync(path.join(MATCHES_DIR, f)); } catch (e) {}
      }
    }

    if (isMongoConnected && mongoDb) {
      await Promise.all([
        mongoDb.collection('users').deleteMany({}),
        mongoDb.collection('rooms').deleteMany({}),
        mongoDb.collection('groups').deleteMany({}),
        mongoDb.collection('matches').deleteMany({}),
        mongoDb.collection('push_subscriptions').deleteMany({})
      ]);
      console.log('🧹 MongoDB Atlas Collections wiped clean!');
    }

    console.log('🧹 Complete Database Reset executed. 0 users, 0 matches, 0 groups, 0 rooms.');
    res.json({ success: true, message: 'All database data and cloud collections wiped clean successfully!' });
  } catch (err) {
    console.error('Failed to clean database:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', (req, res) => {
  try {
    const all = getAllMatchesMap();
    const list = all.map(data => ({
      id: data.id,
      code: data.code,
      matchName: data.matchName,
      savedAt: data.savedAt,
      status: data.status,
      result: data.result,
      teams: data.teams,
      overs: data.overs,
      location: data.location,
      toss: data.toss,
      inningsSummary: (data.innings || []).map(inn => ({
        battingTeam: inn.battingTeam,
        runs: inn.runs,
        wickets: inn.wickets,
        overs: inn.overs,
        balls: inn.balls,
        target: inn.target
      }))
    }));
    res.json({ matches: list });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read match history' });
  }
});

app.get('/api/history/:id', (req, res) => {
  try {
    const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
    const all = getAllMatchesMap();
    const found = all.find(m => m.id === id || m.code === id || m.code === id.toUpperCase());
    if (found) {
      return res.json({ match: found });
    }
    const filePath = path.join(MATCHES_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Match history not found' });
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    res.json({ match: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load match detail' });
  }
});

// ═══════════════════════════════════════════════
//  SOCKET.IO — Real-time
// ═══════════════════════════════════════════════
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPhone = null;

  // ─── Auth Helper ─────────────────────────────────
  function getMe() {
    if (!currentPhone) return null;
    return userStore.get(currentPhone) || null;
  }

  // Recent alerts memory (phone/global -> alert)
  // ─── User Register / Connection Identification ────
  socket.on('user:register', ({ token, phone }) => {
    let verifiedPhone = token ? tokenIndex.get(token) : null;
    if (!verifiedPhone && phone) {
      const cleanP = String(phone).replace(/\D/g, '');
      if (userStore.has(cleanP)) {
        verifiedPhone = cleanP;
      } else if (userStore.has(phone)) {
        verifiedPhone = phone;
      }
    }
    if (verifiedPhone) {
      currentPhone = verifiedPhone;
      socket.join(`user:${verifiedPhone}`);
      const cleanDigits = String(verifiedPhone).replace(/\D/g, '');
      if (cleanDigits !== verifiedPhone) {
        socket.join(`user:${cleanDigits}`);
      }
      socket.join('global:users');
      console.log(`Socket ${socket.id} registered for user:${verifiedPhone} (${getMe()?.name || 'User'})`);
    }
  });

  // ─── Room: Create ────────────────────────────────
  socket.on('room:create', ({ token, matchName, creatorPhone }, cb) => {
    let phone = token ? tokenIndex.get(token) : null;
    if (!phone && creatorPhone) {
      const cleanP = String(creatorPhone).replace(/\D/g, '');
      if (userStore.has(cleanP)) phone = cleanP;
      else if (userStore.has(creatorPhone)) phone = creatorPhone;
    }
    if (!phone && currentPhone) phone = currentPhone;

    if (!phone) {
      if (typeof cb === 'function') cb({ success: false, error: 'Not authenticated' });
      return;
    }
    currentPhone = phone;

    const room = createRoom(matchName, phone);
    currentRoom = room.code;
    room.sockets[socket.id] = phone;

    // Auto-link creator's existing squad if available (one-time setup!)
    const userGroups = getGroupsForPhone(phone);
    if (userGroups.length > 0) {
      const primaryGroup = userGroups[0];
      room.groupId = primaryGroup.id;
      room.groupName = primaryGroup.name;
      if (Array.isArray(primaryGroup.members)) {
        primaryGroup.members.forEach(gm => {
          const clean = String(gm.phone).replace(/\D/g, '');
          if (!room.planning.members[clean]) {
            room.planning.members[clean] = {
              phone: clean,
              name: gm.name,
              color: gm.color || '#00e5ff',
              avatar: gm.avatar || '🏏',
              role: gm.role || 'member',
              vote: null,
              votedAt: null
            };
          }
        });
      }
    }

    socket.join(room.code);
    socket.join(`user:${phone}`);
    socket.join('global:users');

    saveRooms();
    console.log(`Room created: ${room.code} by ${userStore.get(phone)?.name || phone} (Auto-linked squad: ${room.groupName || 'None'})`);
    if (typeof cb === 'function') {
      cb({ success: true, room: getRoomPublicState(room) });
    } else {
      socket.emit('room:created', getRoomPublicState(room));
    }
  });

  // ─── Room: Join ──────────────────────────────────
  socket.on('room:join', ({ token, code, phone: joinPhone }, cb) => {
    let phone = token ? tokenIndex.get(token) : null;
    if (!phone && joinPhone) {
      const cleanP = String(joinPhone).replace(/\D/g, '');
      if (userStore.has(cleanP)) phone = cleanP;
      else if (userStore.has(joinPhone)) phone = joinPhone;
    }
    if (!phone && currentPhone) phone = currentPhone;

    if (!phone) return typeof cb === 'function' && cb({ success: false, error: 'Not authenticated' });
    if (!code || typeof code !== 'string') return typeof cb === 'function' && cb({ success: false, error: 'Valid room code required' });

    const room = rooms.get(code.toUpperCase());
    if (!room) return typeof cb === 'function' && cb({ success: false, error: 'Room not found. Check the code.' });

    currentPhone = phone;
    currentRoom = room.code;
    room.sockets[socket.id] = phone;

    const user = userStore.get(phone);
    // Add to planning members if not already there
    if (!room.planning.members[phone]) {
      room.planning.members[phone] = {
        phone,
        name: user?.name || 'Player',
        color: user?.color || '#00e5ff',
        vote: null,
        comment: '',
        isHost: false,
        joinedAt: Date.now()
      };
    }

    socket.join(room.code);
    socket.join(`user:${phone}`);
    socket.join('global:users');
    saveRooms();
    socket.to(room.code).emit('planning:update', getRoomPublicState(room));
    console.log(`${user?.name || phone} joined room: ${room.code}`);
    if (typeof cb === 'function') {
      cb({ success: true, room: getRoomPublicState(room) });
    } else {
      socket.emit('room:joined', getRoomPublicState(room));
    }
  });

  // ─── Planning: Vote ──────────────────────────────
  socket.on('planning:vote', ({ vote, comment }) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const member = room.planning.members[currentPhone];
    if (!member) return;

    if (vote !== undefined && ['coming', 'not_coming', 'maybe', null].includes(vote)) {
      member.vote = vote;
    }
    if (comment !== undefined) {
      member.comment = sanitizeText(comment, 80);
    }

    saveRooms();
    io.to(currentRoom).emit('planning:update', getRoomPublicState(room));
  });

  // ─── Planning: Match Date & Time ──────────────────
  socket.on('planning:date', ({ date, time }) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (!phonesMatch(room.hostPhone, currentPhone)) return; // Host only

    if (date !== undefined) room.match.date = sanitizeText(date, 20);
    if (time !== undefined) room.match.time = sanitizeText(time, 15);
    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    io.to(currentRoom).emit('planning:update', getRoomPublicState(room));
  });

  // ─── Planning: Ping / Nudge Squad (Popup Alert) ───
  socket.on('planning:nudge', async ({ message, targetPhone }) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const me = getMe();
    const senderName = sanitizeText(me?.name || 'Match Organizer', 30);
    const cleanMessage = sanitizeText(message || `${senderName} is pinging you to confirm availability for ${room.matchName || 'the match'}!`, 140);

    const alertData = {
      id: Date.now(),
      title: '⚡ Cricket Match Alert!',
      message: cleanMessage,
      author: senderName,
      senderPhone: currentPhone,
      matchName: room.matchName,
      roomCode: room.code,
      date: room.match.date,
      time: room.match.time,
      isDirect: !!targetPhone,
      targetPhone: targetPhone || null,
      timestamp: Date.now()
    };

    console.log(`[planning:nudge] 📣 ${senderName} (+${currentPhone}) sending nudge to ${targetPhone ? `+${targetPhone}` : 'ALL squad members'} in room ${room.code}`);

    const cleanSender = String(currentPhone).replace(/\D/g, '');
    if (targetPhone) {
      const cleanDigits = String(targetPhone).replace(/\D/g, '');
      io.to(`user:${cleanDigits}`).emit('popup:alert', alertData);
      if (cleanDigits !== targetPhone) {
        io.to(`user:${targetPhone}`).emit('popup:alert', alertData);
      }
    } else if (room.groupId && groups.has(room.groupId)) {
      // Isolate nudge strictly to members of this group & room planning members
      const g = groups.get(room.groupId);
      const groupPhones = new Set((g.members || []).map(m => String(m.phone).replace(/\D/g, '')));
      Object.keys(room.planning.members || {}).forEach(p => groupPhones.add(String(p).replace(/\D/g, '')));
      groupPhones.delete(cleanSender);

      groupPhones.forEach(phone => {
        io.to(`user:${phone}`).emit('popup:alert', alertData);
      });
    } else {
      // Room participants only
      const roomPhones = new Set(Object.keys(room.planning.members || {}).map(p => String(p).replace(/\D/g, '')));
      roomPhones.delete(cleanSender);
      if (roomPhones.size > 0) {
        roomPhones.forEach(phone => {
          io.to(`user:${phone}`).emit('popup:alert', alertData);
        });
      } else {
        socket.to('global:users').except(`user:${cleanSender}`).except(`user:${currentPhone}`).emit('popup:alert', alertData);
      }
    }

    await sendWebPush(targetPhone || null, alertData, currentPhone);
  });

  // ─── Group Association for Match ──────────────────
  socket.on('room:setGroup', ({ groupId }, cb) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!phonesMatch(room.hostPhone, currentPhone)) {
      if (typeof cb === 'function') cb({ success: false, error: 'Only match organizer can link squad' });
      return;
    }

    if (!groupId) {
      room.groupId = null;
      room.groupName = null;
    } else {
      const g = groups.get(groupId);
      if (g) {
        room.groupId = g.id;
        room.groupName = g.name;
        // Auto-add group members into room planning squad if not already present
        if (Array.isArray(g.members)) {
          g.members.forEach(gm => {
            const clean = String(gm.phone).replace(/\D/g, '');
            if (!room.planning.members[clean]) {
              room.planning.members[clean] = {
                phone: clean,
                name: gm.name,
                color: gm.color || '#00e5ff',
                avatar: gm.avatar || '🏏',
                vote: null,
                votedAt: null
              };
            }
          });
        }
      }
    }
    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    io.to(currentRoom).emit('planning:update', getRoomPublicState(room));
    if (typeof cb === 'function') cb({ success: true, room: getRoomPublicState(room) });
  });

  socket.on('group:list', (data, cb) => {
    if (!currentPhone) {
      if (typeof cb === 'function') cb({ groups: [] });
      return;
    }
    const userGroups = getGroupsForPhone(currentPhone);
    if (typeof cb === 'function') cb({ groups: userGroups });
  });

  // ─── Match Setup (Host Only) ─────────────────────
  socket.on('match:setup', (data = {}) => {
    const { overs, location, date, time } = data;
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (!phonesMatch(room.hostPhone, currentPhone)) return; // Strict Host Check

    if (room.match.status === 'planning') {
      room.match.status = 'setup';
    }

    const teamsObj = data.teams || (data.team1 || data.team2 ? { team1: data.team1, team2: data.team2 } : null);
    if (teamsObj) {
      if (teamsObj.team1) {
        if (teamsObj.team1.name) room.match.teams.team1.name = sanitizeText(teamsObj.team1.name, 35);
        if (Array.isArray(teamsObj.team1.players)) {
          room.match.teams.team1.players = teamsObj.team1.players
            .map(p => (typeof p === 'string' ? sanitizeText(p, 35) : sanitizeText(p?.name || p?.id || '', 35)))
            .filter(Boolean)
            .slice(0, 25);
        }
      }
      if (teamsObj.team2) {
        if (teamsObj.team2.name) room.match.teams.team2.name = sanitizeText(teamsObj.team2.name, 35);
        if (Array.isArray(teamsObj.team2.players)) {
          room.match.teams.team2.players = teamsObj.team2.players
            .map(p => (typeof p === 'string' ? sanitizeText(p, 35) : sanitizeText(p?.name || p?.id || '', 35)))
            .filter(Boolean)
            .slice(0, 25);
        }
      }
    }

    if (overs !== undefined) {
      const parsedOvers = parseInt(overs);
      if (!isNaN(parsedOvers) && parsedOvers >= 1 && parsedOvers <= 100) {
        room.match.overs = parsedOvers;
      }
    }

    if (location !== undefined) {
      const locText = sanitizeText(location?.text || '', 120);
      let locMap = location?.mapUrl ? String(location.mapUrl).trim() : '';
      if (locMap && !isValidHttpUrl(locMap)) locMap = ''; // neutralize invalid/malicious URLs
      room.match.location = { text: locText, mapUrl: locMap.slice(0, 300) };
    }

    if (date !== undefined) room.match.date = sanitizeText(date, 20);
    if (time !== undefined) room.match.time = sanitizeText(time, 15);

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    io.to(currentRoom).emit('planning:update', getRoomPublicState(room));
  });

  socket.on('match:startToss', () => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room || !phonesMatch(room.hostPhone, currentPhone)) return;
    room.match.status = 'toss';
    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
  });

  socket.on('match:toss', ({ winner, choice, decision }) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room || !phonesMatch(room.hostPhone, currentPhone)) return;
    const ch = choice || decision;
    if (!['team1', 'team2'].includes(winner) || !['bat', 'bowl'].includes(ch)) return;

    room.match.toss = { winner, choice: ch };
    room.match.battingFirst = ch === 'bat' ? winner : (winner === 'team1' ? 'team2' : 'team1');
    room.match.status = 'innings1';
    const inn = room.match.innings[0];
    inn.battingTeam = room.match.battingFirst;
    inn.bowlingTeam = room.match.battingFirst === 'team1' ? 'team2' : 'team1';
    const inn2 = room.match.innings[1];
    if (inn2) {
      inn2.battingTeam = inn.bowlingTeam;
      inn2.bowlingTeam = inn.battingTeam;
    }
    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
  });

  // ─── Super Over Shootout (Host Only on Tied Match) ──
  socket.on('match:startSuperOver', () => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room || !phonesMatch(room.hostPhone, currentPhone)) return;

    const inn1 = room.match.innings[0];
    const inn2 = room.match.innings[1];
    if (!inn1 || !inn2 || inn1.runs !== inn2.runs) return;

    room.match.isSuperOver = true;
    room.match.status = 'super_over_inn1';

    const so1 = createInnings();
    const so2 = createInnings();
    so1.battingTeam = inn2.battingTeam;
    so1.bowlingTeam = inn2.bowlingTeam;

    room.match.innings[2] = so1;
    room.match.innings[3] = so2;
    room.match.currentInnings = 2;

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    const sysMsg = {
      id: Date.now(),
      author: 'CricketHub System',
      color: '#ffb74d',
      text: '⚡ SUPER OVER SHOOTOUT LAUNCHED! 1 Over per team • 2 Wickets Max • Winner takes all! 🏆',
      timestamp: new Date().toISOString()
    };
    room.match.chat.push(sysMsg);
    if (room.match.chat.length > 200) room.match.chat.shift();
    io.to(currentRoom).emit('chat:message', sysMsg);
  });

  // ─── Match: Reset (Host Only) ─────────────────────
  socket.on('match:reset', (cb) => {
    if (!currentRoom || !currentPhone) {
      if (typeof cb === 'function') cb({ success: false, error: 'Unauthorized' });
      return;
    }
    const room = rooms.get(currentRoom);
    if (!room) {
      if (typeof cb === 'function') cb({ success: false, error: 'Room not found' });
      return;
    }
    if (!phonesMatch(room.hostPhone, currentPhone)) {
      if (typeof cb === 'function') cb({ success: false, error: 'Only the host can reset the match' });
      return;
    }

    // Archive current match if it had any scoring
    const hasScoring = room.match.innings && room.match.innings.some(inn => (inn.balls > 0 || inn.runs > 0 || inn.wickets > 0));
    if (hasScoring) {
      saveMatchToHistory(room);
    }

    // Reset match state while preserving teams, overs, location, announcements, chat
    const prevTeams = JSON.parse(JSON.stringify(room.match.teams));
    const prevOvers = room.match.overs;
    const prevLoc = JSON.parse(JSON.stringify(room.match.location));
    const prevDate = room.match.date;
    const prevTime = room.match.time;
    const prevAnn = JSON.parse(JSON.stringify(room.match.announcements));
    const prevChat = JSON.parse(JSON.stringify(room.match.chat));

    room.match = {
      status: 'planning',
      date: prevDate || '',
      time: prevTime || '',
      teams: prevTeams,
      overs: prevOvers || 20,
      toss: null,
      battingFirst: null,
      location: prevLoc,
      innings: [createInnings(), createInnings()],
      currentInnings: 0,
      announcements: prevAnn,
      chat: prevChat
    };

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    io.to(currentRoom).emit('planning:update', getRoomPublicState(room));
    if (typeof cb === 'function') cb({ success: true, room: getRoomPublicState(room) });
  });

  // ─── Match Rematch / Start Match 2 in Same Room (Host Only) ─
  socket.on('match:rematch', ({ resetToSetup } = {}, cb) => {
    if (!currentRoom || !currentPhone) {
      if (typeof cb === 'function') cb({ success: false, error: 'Unauthorized' });
      return;
    }
    const room = rooms.get(currentRoom);
    if (!room) {
      if (typeof cb === 'function') cb({ success: false, error: 'Room not found' });
      return;
    }
    if (!phonesMatch(room.hostPhone, currentPhone)) {
      if (typeof cb === 'function') cb({ success: false, error: 'Only the host can start a rematch' });
      return;
    }

    // Save completed match to archive / history
    const hasScoring = room.match.innings && room.match.innings.some(inn => (inn.balls > 0 || inn.runs > 0 || inn.wickets > 0));
    if (hasScoring) {
      saveMatchToHistory(room);
    }

    // Keep teams, overs, location, date, time, announcements, chat
    const prevTeams = JSON.parse(JSON.stringify(room.match.teams || {
      team1: { name: 'Team 1', players: [] },
      team2: { name: 'Team 2', players: [] }
    }));
    const prevOvers = room.match.overs || 20;
    const prevLoc = JSON.parse(JSON.stringify(room.match.location || { text: '', mapUrl: '' }));
    const prevDate = room.match.date || '';
    const prevTime = room.match.time || '';
    const prevAnn = JSON.parse(JSON.stringify(room.match.announcements || []));
    const prevChat = JSON.parse(JSON.stringify(room.match.chat || []));

    room.match = {
      status: resetToSetup ? 'setup' : 'toss',
      date: prevDate,
      time: prevTime,
      teams: prevTeams,
      overs: prevOvers,
      toss: null,
      battingFirst: null,
      location: prevLoc,
      innings: [createInnings(), createInnings()],
      currentInnings: 0,
      isSuperOver: false,
      announcements: prevAnn,
      chat: prevChat
    };

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    const rematchMsg = {
      id: Date.now(),
      author: 'CricketHub System',
      color: '#00e5ff',
      text: resetToSetup
        ? '⚙️ Match setup reset for the next game! You can modify teams, overs, or players.'
        : '🔄 Match 2 / Rematch started by Host! Head to Toss to begin.',
      timestamp: new Date().toISOString()
    };
    room.match.chat.push(rematchMsg);
    if (room.match.chat.length > 200) room.match.chat.shift();
    io.to(currentRoom).emit('chat:message', rematchMsg);

    if (typeof cb === 'function') cb({ success: true, status: room.match.status });
  });

  // ─── Scoring ─────────────────────────────────────
  socket.on('score:ball', ({ inningsIdx, runs, extras, wicket, dismissal, dismissalType, dismissedSlot, token }) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const inn = room.match.innings[inningsIdx];
    if (!inn || inn.completed) return;

    // Strict validation: cannot bowl if awaiting new bowler or awaiting next batter
    if (inn.awaitingNewBatsman) {
      socket.emit('score:error', { message: 'Next batter must be selected before bowling the next ball.' });
      return;
    }
    if (inn.awaitingNewBowler) {
      socket.emit('score:error', { message: 'Next bowler must be selected before bowling the next ball.' });
      return;
    }
    if (inn.currentBatsmen[0] === null) {
      socket.emit('score:error', { message: 'Please select striker before bowling.' });
      return;
    }
    if (!inn.isSingleBatter && inn.currentBatsmen[1] === null) {
      socket.emit('score:error', { message: 'Please select both batsmen before bowling (or switch to Single Batter Mode).' });
      return;
    }
    if (inn.currentBowler === null) {
      socket.emit('score:error', { message: 'Please select a bowler before bowling.' });
      return;
    }

    const isWide = !!extras?.wide;
    const isNoBall = !!extras?.noBall;
    const isWicketBall = !!wicket;

    const typeStr = (dismissalType || '').toLowerCase().trim();
    const noteStr = (typeof dismissal === 'string' ? dismissal : '').toLowerCase().trim();

    const isRunOut = isWicketBall && (
      typeStr === 'run out' ||
      typeStr === 'run_out' ||
      typeStr === 'runout' ||
      noteStr.startsWith('run out') ||
      noteStr.startsWith('run_out') ||
      noteStr.startsWith('runout') ||
      noteStr.includes('run out')
    );

    const isRetired = isWicketBall && (
      typeStr.includes('retired') ||
      noteStr.includes('retired')
    );

    // Bowler gets wicket credit for Bowled, Caught / Catch, Stumped, LBW, Hit Wicket, etc. (all except Run Out / Retired)
    const isBowlerWicket = isWicketBall && !isRunOut && !isRetired;

    // Wicket priority: For normal wickets (Bowled, Caught, LBW, Stumped, Hit Wicket), bat runs are 0.
    // For Run Outs, bat runs can be the completed runs (e.g. 0, 1, 2) before the dismissal.
    let rawRuns = parseInt(runs) || 0;
    if (isWicketBall && !isRunOut) {
      rawRuns = 0; // Wicket takes priority over bat runs
    }
    const safeRuns = Math.max(0, Math.min(6, rawRuns));

    const isBye = !!extras?.bye;
    const isLegBye = !!extras?.legBye;
    const byeRuns = isBye ? Math.min(6, parseInt(extras.bye) || (safeRuns > 0 ? safeRuns : 1)) : 0;
    const legByeRuns = isLegBye ? Math.min(6, parseInt(extras.legBye) || (safeRuns > 0 ? safeRuns : 1)) : 0;

    // Bat runs: 0 if Bye or LegBye
    const batRuns = (isBye || isLegBye) ? 0 : safeRuns;

    // ── Snapshot for undo (before applying this ball) ──
    inn._history.push(snapshotInnings(inn));
    if (inn._history.length > 50) inn._history.shift(); // cap history at 50 balls
    inn._redoStack = []; // new ball clears redo stack

    let teamBallRuns = batRuns;
    if (isWide) { inn.extras.wide += 1; teamBallRuns += 1; }
    if (isNoBall) { inn.extras.noBall += 1; teamBallRuns += 1; }
    if (isBye) { inn.extras.bye += byeRuns; teamBallRuns += byeRuns; }
    if (isLegBye) { inn.extras.legBye += legByeRuns; teamBallRuns += legByeRuns; }
    inn.runs += teamBallRuns;

    let ballStr = String(safeRuns);
    if (isWide) ballStr = isWicketBall ? (isRunOut ? 'Wd+W(RO)' : 'Wd+W') : 'Wd';
    else if (isNoBall) ballStr = isWicketBall ? (isRunOut ? 'Nb+W(RO)' : 'Nb+W') : 'Nb';
    else if (isBye) ballStr = `B${byeRuns}`;
    else if (isLegBye) ballStr = `Lb${legByeRuns}`;
    else if (isWicketBall) ballStr = isRunOut ? 'W(RO)' : 'W';
    inn.currentOver.push(ballStr);

    const bi = inn.currentBowler;
    const bowlerName = (bi !== null && inn.bowlers[bi] && inn.bowlers[bi].name) ? inn.bowlers[bi].name.trim() : '';

    function formatDismissalText(userNote, type, isBowlerWick, bName) {
      const cleanNote = (userNote || '').trim();
      const cleanType = (type || '').trim();

      if (cleanNote) {
        if (!isBowlerWick) return cleanNote;
        // If note already contains ' b ' or ' b.' or 'c&b' or 'c & b'
        if (/\bb\s+[A-Za-z0-9]/i.test(cleanNote) || /\bb\.\s*[A-Za-z0-9]/i.test(cleanNote) || cleanNote.toLowerCase().includes('c & b') || cleanNote.toLowerCase().includes('c&b')) {
          return cleanNote;
        }
        // If note is something like "c Kohli" or "st Dhoni" and bName is present
        if (bName) {
          return `${cleanNote} b ${bName}`;
        }
        return cleanNote;
      }

      if (!isBowlerWick) {
        return cleanType || 'run out';
      }

      const lowerType = cleanType.toLowerCase();
      if (lowerType === 'bowled' || lowerType === 'b') {
        return bName ? `b ${bName}` : 'bowled';
      }
      if (lowerType === 'caught' || lowerType === 'catch' || lowerType === 'c') {
        return bName ? `c & b ${bName}` : 'caught';
      }
      if (lowerType === 'stumped' || lowerType === 'st') {
        return bName ? `st b ${bName}` : 'stumped';
      }
      if (lowerType === 'lbw') {
        return bName ? `lbw b ${bName}` : 'lbw';
      }
      if (lowerType === 'hit wicket' || lowerType === 'hit_wicket') {
        return bName ? `hit wicket b ${bName}` : 'hit wicket';
      }

      return bName ? `${cleanType || 'out'} b ${bName}` : (cleanType || 'out');
    }

    let dismissedStrikerIdx = null;
    let dismissedNonStrikerIdx = null;

    if (isWicketBall) {
      inn.wickets += 1;
      const isNonStrikerOut = isRunOut && (dismissedSlot === 'non_striker' || dismissedSlot === 'nonStriker') && inn.currentBatsmen[1] !== null;

      if (isNonStrikerOut) {
        // Non-Striker is Run Out
        const nsi = inn.currentBatsmen[1];
        if (nsi !== null && inn.batsmen[nsi]) {
          inn.batsmen[nsi].out = true;
          inn.batsmen[nsi].dismissal = sanitizeText(formatDismissalText(dismissal, dismissalType || 'Run Out', false, bowlerName), 40);
          dismissedNonStrikerIdx = nsi;
        }
        inn.dismissedBatsmanIdx = nsi;
        inn.currentBatsmen[1] = null; // Non-striker dismissed

        // Striker faces the delivery
        const si = inn.currentBatsmen[0];
        if (si !== null && inn.batsmen[si]) {
          inn.batsmen[si].runs += safeRuns;
          if (!isWide) inn.batsmen[si].balls += 1;
          if (safeRuns === 4) inn.batsmen[si].fours += 1;
          if (safeRuns === 6) inn.batsmen[si].sixes += 1;
        }

        // If odd completed runs, striker crossed ends
        if (safeRuns % 2 !== 0 && !inn.isSingleBatter) {
          inn.currentBatsmen[1] = inn.currentBatsmen[0];
          inn.currentBatsmen[0] = null;
        }
      } else {
        // Striker is Out (Bowled, Caught, LBW, Stumped, Hit Wicket, or Run Out)
        const si = inn.currentBatsmen[0];
        if (si !== null && inn.batsmen[si]) {
          inn.batsmen[si].out = true;
          inn.batsmen[si].dismissal = sanitizeText(formatDismissalText(dismissal, dismissalType, isBowlerWicket, bowlerName), 40);
          inn.batsmen[si].runs += safeRuns;
          if (!isWide) inn.batsmen[si].balls += 1;
          if (safeRuns === 4) inn.batsmen[si].fours += 1;
          if (safeRuns === 6) inn.batsmen[si].sixes += 1;
          dismissedStrikerIdx = si;
        }
        inn.dismissedBatsmanIdx = si;
        inn.currentBatsmen[0] = null; // Striker dismissed

        // If odd runs completed on striker runout, non-striker crossed ends
        if (isRunOut && safeRuns % 2 !== 0 && !inn.isSingleBatter && inn.currentBatsmen[1] !== null) {
          inn.currentBatsmen[0] = inn.currentBatsmen[1];
          inn.currentBatsmen[1] = null;
        }
      }
    } else {
      // Normal ball (no wicket)
      const si = inn.currentBatsmen[0];
      if (si !== null && inn.batsmen[si] && !isWide && !isNoBall) {
        inn.batsmen[si].runs += batRuns;
        inn.batsmen[si].balls += 1;
        if (batRuns === 4) inn.batsmen[si].fours += 1;
        if (batRuns === 6) inn.batsmen[si].sixes += 1;
      }
    }

    if (bi !== null && inn.bowlers[bi]) {
      let bowlerConceded = batRuns;
      if (isWide) bowlerConceded += 1;
      if (isNoBall) bowlerConceded += 1;
      // Note: Byes and Leg-Byes are NOT charged to bowler in cricket
      inn.bowlers[bi].runs = (parseInt(inn.bowlers[bi].runs) || 0) + bowlerConceded;
      // Bowler gets wicket credit for Bowled, Caught, Stumped, LBW, Hit Wicket, etc. (all except Run Out / Retired)
      if (isBowlerWicket) {
        inn.bowlers[bi].wickets = (parseInt(inn.bowlers[bi].wickets) || 0) + 1;
      }
    }

    const isSuperOverInn = inningsIdx >= 2;
    // Standard cricket innings allows up to 10 wickets (or 2 in Super Over).
    // In small team / casual matches, host can choose next batter, play solo, or declare all-out.
    const maxWickets = isSuperOverInn ? 2 : 10;
    const maxOvers = isSuperOverInn ? 1 : room.match.overs;

    if (!isWide && !isNoBall) {
      inn.balls += 1;
      inn.overs = Math.floor(inn.balls / 6);
      if (inn.balls % 6 === 0) {
        // ── End of over ──────────────────────────────────
        inn.ballLog.push([...inn.currentOver]);
        inn.currentOver = [];
        if (bi !== null && inn.bowlers[bi]) inn.bowlers[bi].overs += 1;

        // Strike changes at end of over (if not in single batter mode)
        if (!inn.isSingleBatter && inn.currentBatsmen[0] !== null && inn.currentBatsmen[1] !== null) {
          const tmp = inn.currentBatsmen[0];
          inn.currentBatsmen[0] = inn.currentBatsmen[1];
          inn.currentBatsmen[1] = tmp;
        }

        // Signal client to pick a new bowler (unless innings just ended)
        const willComplete = inn.wickets >= maxWickets || Math.floor(inn.balls / 6) >= maxOvers;
        if (!willComplete) {
          inn.lastBowlerIdx = bi;     // track who just bowled (to prevent consecutive)
          inn.currentBowler = null;   // block scoring until new bowler chosen
          inn.awaitingNewBowler = true;
        }
      } else if (safeRuns % 2 !== 0 && !wicket && !inn.isSingleBatter && inn.currentBatsmen[0] !== null && inn.currentBatsmen[1] !== null) {
        // Mid-over odd-run strike change
        const tmp = inn.currentBatsmen[0];
        inn.currentBatsmen[0] = inn.currentBatsmen[1];
        inn.currentBatsmen[1] = tmp;
      }
    }

    const isAllBattersOut = checkAllBattersOut(room.match, inn);

    let justCompleted = false;
    if (Math.floor(inn.balls / 6) >= maxOvers) {
      // Overs limit completed
      inn.completed = true;
      inn.awaitingNewBatsman = false;
      inn.awaitingNewBowler = false;
      if (inningsIdx === 0) {
        const inn2 = room.match.innings[1];
        inn2.battingTeam = inn.bowlingTeam;
        inn2.bowlingTeam = inn.battingTeam;
        inn2.target = inn.runs + 1;
        room.match.currentInnings = 1;
        room.match.status = 'innings2';
      } else if (inningsIdx === 1) {
        room.match.status = 'completed';
        justCompleted = true;
      } else if (inningsIdx === 2) {
        const so2 = room.match.innings[3];
        so2.battingTeam = inn.bowlingTeam;
        so2.bowlingTeam = inn.battingTeam;
        so2.target = inn.runs + 1;
        room.match.currentInnings = 3;
        room.match.status = 'super_over_inn2';
      } else if (inningsIdx === 3) {
        room.match.status = 'completed';
        justCompleted = true;
      }
    } else if (isAllBattersOut && (inningsIdx === 1 || inningsIdx === 3)) {
      // 2nd innings all out: match is completely over, transition directly to completed status!
      inn.completed = true;
      inn.awaitingNewBatsman = false;
      inn.awaitingNewBowler = false;
      room.match.status = 'completed';
      justCompleted = true;
    } else if (isAllBattersOut && (inningsIdx === 0 || inningsIdx === 2)) {
      // 1st innings all out: transition directly to 2nd innings!
      inn.completed = true;
      inn.awaitingNewBatsman = false;
      inn.awaitingNewBowler = false;
      if (inningsIdx === 0) {
        const inn2 = room.match.innings[1];
        inn2.battingTeam = inn.bowlingTeam;
        inn2.bowlingTeam = inn.battingTeam;
        inn2.target = inn.runs + 1;
        room.match.currentInnings = 1;
        room.match.status = 'innings2';
      } else if (inningsIdx === 2) {
        const so2 = room.match.innings[3];
        so2.battingTeam = inn.bowlingTeam;
        so2.bowlingTeam = inn.battingTeam;
        so2.target = inn.runs + 1;
        room.match.currentInnings = 3;
        room.match.status = 'super_over_inn2';
      }
    } else if (wicket && !isWide && !isNoBall) {
      // A wicket fell -> pause for host to pick next batter, play single batter, or declare all out
      inn.awaitingNewBatsman = true;
    }

    if ((inningsIdx === 1 || inningsIdx === 3) && inn.target !== null && inn.runs >= inn.target) {
      inn.completed = true;
      inn.awaitingNewBatsman = false;
      inn.awaitingNewBowler = false;
      room.match.status = 'completed';
      justCompleted = true;
    }

    if (justCompleted) {
      saveMatchToHistory(room);
    }

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
  });

  // ─── Undo last ball ──────────────────────────────
  socket.on('score:undo', ({ inningsIdx }) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const inn = room.match.innings[inningsIdx];
    if (!inn || inn._history.length === 0) return;

    // Push current to redo stack, restore previous snapshot
    inn._redoStack.push(snapshotInnings(inn));
    const prev = inn._history.pop();
    restoreInnings(inn, prev);

    // If innings was marked completed, un-complete match status
    if (!inn.completed && inningsIdx === room.match.currentInnings) {
      if (room.match.status === 'innings2' && inningsIdx === 1) {
        room.match.status = 'innings2';
      } else if (room.match.status === 'completed') {
        room.match.status = inningsIdx === 0 ? 'innings1' : 'innings2';
      }
    }

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
  });

  // ─── Redo (re-apply undone ball) ─────────────────
  socket.on('score:redo', ({ inningsIdx }) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const inn = room.match.innings[inningsIdx];
    if (!inn || inn._redoStack.length === 0) return;

    // Push current to history, restore redo snapshot
    inn._history.push(snapshotInnings(inn));
    const next = inn._redoStack.pop();
    restoreInnings(inn, next);

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
  });

  socket.on('score:setBatsmen', ({ inningsIdx, striker, nonStriker, isSingleBatter, token }, cb) => {
    if (!currentRoom) {
      if (typeof cb === 'function') cb({ success: false, error: 'Unauthorized' });
      return;
    }
    const room = rooms.get(currentRoom);
    if (!room) {
      if (typeof cb === 'function') cb({ success: false, error: 'Room not found' });
      return;
    }

    let callerPhone = currentPhone;
    if (token && tokenIndex.has(token)) {
      callerPhone = tokenIndex.get(token);
    }
    if (!callerPhone && room.sockets && room.sockets[socket.id]) {
      callerPhone = room.sockets[socket.id];
    }
    if (callerPhone) currentPhone = callerPhone;

    const isHostCaller = callerPhone && phonesMatch(room.hostPhone, callerPhone);
    const isHostSocket = room.sockets?.[socket.id] && phonesMatch(room.hostPhone, room.sockets[socket.id]);

    if (!isHostCaller && !isHostSocket) {
      if (typeof cb === 'function') cb({ success: false, error: 'Host only' });
      return;
    }
    const idx = (typeof inningsIdx === 'number' && inningsIdx >= 0) ? inningsIdx : room.match.currentInnings;
    const inn = room.match.innings[idx];
    if (!inn) {
      if (typeof cb === 'function') cb({ success: false, error: 'Innings not found' });
      return;
    }

    const safeStriker = sanitizeText(striker, 35);
    const safeNonStriker = sanitizeText(nonStriker, 35);
    const singleMode = !!isSingleBatter || !safeNonStriker;

    inn.isSingleBatter = singleMode;

    [safeStriker, safeNonStriker].forEach(name => {
      if (name && !inn.batsmen.find(b => b.name === name))
        inn.batsmen.push({ name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' });
      if (name && room.match?.teams?.[inn.battingTeam]?.players) {
        const teamPlayers = room.match.teams[inn.battingTeam].players;
        const exists = teamPlayers.some(p => (typeof p === 'string' ? p : p?.name) === name);
        if (!exists) teamPlayers.push(name);
      }
    });
    inn.currentBatsmen[0] = inn.batsmen.findIndex(b => b.name === safeStriker);
    inn.currentBatsmen[1] = singleMode ? null : inn.batsmen.findIndex(b => b.name === safeNonStriker);
    inn.awaitingNewBatsman = false;

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    if (typeof cb === 'function') cb({ success: true });
  });

  socket.on('score:nextBatsman', (data, cb) => {
    if (typeof data === 'function') {
      cb = data;
      data = {};
    }
    const { inningsIdx, batsmanName, isSingleBatter, token } = (data || {});

    if (!currentRoom) {
      if (typeof cb === 'function') cb({ success: false, error: 'Unauthorized' });
      return;
    }
    const room = rooms.get(currentRoom);
    if (!room) {
      if (typeof cb === 'function') cb({ success: false, error: 'Room not found' });
      return;
    }

    let callerPhone = currentPhone;
    if (token && tokenIndex.has(token)) {
      callerPhone = tokenIndex.get(token);
    }
    if (!callerPhone && room.sockets && room.sockets[socket.id]) {
      callerPhone = room.sockets[socket.id];
    }
    if (callerPhone) currentPhone = callerPhone;

    const isHostCaller = callerPhone && phonesMatch(room.hostPhone, callerPhone);
    const isHostSocket = room.sockets?.[socket.id] && phonesMatch(room.hostPhone, room.sockets[socket.id]);

    if (!isHostCaller && !isHostSocket) {
      if (typeof cb === 'function') cb({ success: false, error: 'Host only' });
      return;
    }
    const idx = (typeof inningsIdx === 'number' && inningsIdx >= 0) ? inningsIdx : room.match.currentInnings;
    const inn = room.match.innings[idx];
    if (!inn) {
      if (typeof cb === 'function') cb({ success: false, error: 'Innings not found' });
      return;
    }

    if (isSingleBatter) {
      // Check if there is an un-dismissed surviving batter to play solo
      const nonStrikerIdx = inn.currentBatsmen[1];
      const strikerIdx = inn.currentBatsmen[0];
      const hasSurvivingNonStriker = nonStrikerIdx !== null && inn.batsmen[nonStrikerIdx] && !inn.batsmen[nonStrikerIdx].out;
      const hasSurvivingStriker = strikerIdx !== null && inn.batsmen[strikerIdx] && !inn.batsmen[strikerIdx].out;

      if (!hasSurvivingNonStriker && !hasSurvivingStriker) {
        if (typeof cb === 'function') cb({ success: false, error: 'All batters are out! Single batter mode is unavailable.' });
        return;
      }

      inn.isSingleBatter = true;
      // If striker slot was out and non-striker is remaining, non-striker becomes the solo striker
      if (inn.currentBatsmen[0] === null && hasSurvivingNonStriker) {
        inn.currentBatsmen[0] = inn.currentBatsmen[1];
        inn.currentBatsmen[1] = null;
      }
      inn.awaitingNewBatsman = false;
    } else {
      const safeName = sanitizeText(batsmanName, 35);
      if (!safeName) return;

      if (!inn.batsmen.find(b => b.name === safeName)) {
        inn.batsmen.push({ name: safeName, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: '' });
      }
      if (room.match?.teams?.[inn.battingTeam]?.players) {
        const teamPlayers = room.match.teams[inn.battingTeam].players;
        const exists = teamPlayers.some(p => (typeof p === 'string' ? p : p?.name) === safeName);
        if (!exists) teamPlayers.push(safeName);
      }
      const newIdx = inn.batsmen.findIndex(b => b.name === safeName);
      inn.batsmen[newIdx].out = false;

      // Assign to the empty slot (striker slot if empty, otherwise non-striker)
      if (inn.currentBatsmen[0] === null) {
        inn.currentBatsmen[0] = newIdx;
      } else {
        inn.currentBatsmen[1] = newIdx;
      }
      inn.awaitingNewBatsman = false;
    }

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    if (typeof cb === 'function') cb({ success: true });
  });

  // ─── Declare / End Innings (All Out) ──────────────
  socket.on('score:endInnings', (data, cb) => {
    if (typeof data === 'function') {
      cb = data;
      data = {};
    }
    const inningsIdx = data?.inningsIdx;
    const token = data?.token;

    if (!currentRoom) {
      if (typeof cb === 'function') cb({ success: false, error: 'Not connected to room' });
      return;
    }
    const room = rooms.get(currentRoom);
    if (!room) {
      if (typeof cb === 'function') cb({ success: false, error: 'Room not found' });
      return;
    }

    let callerPhone = currentPhone;
    if (token && tokenIndex.has(token)) {
      callerPhone = tokenIndex.get(token);
    }
    if (!callerPhone && room.sockets && room.sockets[socket.id]) {
      callerPhone = room.sockets[socket.id];
    }
    if (callerPhone) currentPhone = callerPhone;

    const isHostCaller = callerPhone && phonesMatch(room.hostPhone, callerPhone);
    const isHostSocket = room.sockets?.[socket.id] && phonesMatch(room.hostPhone, room.sockets[socket.id]);

    if (!isHostCaller && !isHostSocket) {
      if (typeof cb === 'function') cb({ success: false, error: 'Only the host can end innings' });
      return;
    }

    const idx = (typeof inningsIdx === 'number' && inningsIdx >= 0) ? inningsIdx : room.match.currentInnings;
    const inn = room.match.innings[idx];
    if (!inn) {
      if (typeof cb === 'function') cb({ success: false, error: 'Innings not found' });
      return;
    }

    inn.completed = true;
    inn.awaitingNewBatsman = false;
    inn.awaitingNewBowler = false;

    let justCompleted = false;
    if (idx === 0) {
      const inn2 = room.match.innings[1];
      inn2.battingTeam = inn.bowlingTeam;
      inn2.bowlingTeam = inn.battingTeam;
      inn2.target = inn.runs + 1;
      room.match.currentInnings = 1;
      room.match.status = 'innings2';
    } else if (idx === 1) {
      room.match.status = 'completed';
      justCompleted = true;
    } else if (idx === 2) {
      const so2 = room.match.innings[3];
      so2.battingTeam = inn.bowlingTeam;
      so2.bowlingTeam = inn.battingTeam;
      so2.target = inn.runs + 1;
      room.match.currentInnings = 3;
      so2.target = inn.runs + 1;
      room.match.status = 'super_over_inn2';
    } else if (idx === 3) {
      room.match.status = 'completed';
      justCompleted = true;
    }

    if (justCompleted) {
      saveMatchToHistory(room);
    }

    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    if (typeof cb === 'function') cb({ success: true, status: room.match.status });
  });

  socket.on('score:setBowler', ({ inningsIdx, bowlerName, token }, cb) => {
    if (!currentRoom) {
      if (typeof cb === 'function') cb({ success: false, error: 'Unauthorized' });
      return;
    }
    const room = rooms.get(currentRoom);
    if (!room) {
      if (typeof cb === 'function') cb({ success: false, error: 'Room not found' });
      return;
    }

    let callerPhone = currentPhone;
    if (token && tokenIndex.has(token)) {
      callerPhone = tokenIndex.get(token);
    }
    if (!callerPhone && room.sockets && room.sockets[socket.id]) {
      callerPhone = room.sockets[socket.id];
    }
    if (callerPhone) currentPhone = callerPhone;

    const isHostCaller = callerPhone && phonesMatch(room.hostPhone, callerPhone);
    const isHostSocket = room.sockets?.[socket.id] && phonesMatch(room.hostPhone, room.sockets[socket.id]);

    if (!isHostCaller && !isHostSocket) {
      if (typeof cb === 'function') cb({ success: false, error: 'Host only' });
      return;
    }
    const idx = (typeof inningsIdx === 'number' && inningsIdx >= 0) ? inningsIdx : room.match.currentInnings;
    const inn = room.match.innings[idx];
    if (!inn) {
      if (typeof cb === 'function') cb({ success: false, error: 'Innings not found' });
      return;
    }

    const safeBowler = sanitizeText(bowlerName, 35);
    if (!safeBowler) {
      if (typeof cb === 'function') cb({ success: false, error: 'Invalid bowler name' });
      return;
    }

    // Prevent same bowler bowling consecutive overs
    if (inn.awaitingNewBowler && inn.lastBowlerIdx !== null) {
      const lastBowler = inn.bowlers[inn.lastBowlerIdx];
      if (lastBowler && lastBowler.name === safeBowler) {
        socket.emit('score:error', { message: `${safeBowler} just bowled the last over. Pick a different bowler.` });
        return;
      }
    }

    if (!inn.bowlers.find(b => b.name === safeBowler))
      inn.bowlers.push({ name: safeBowler, overs: 0, maidens: 0, runs: 0, wickets: 0 });
    if (room.match?.teams?.[inn.bowlingTeam]?.players) {
      const teamPlayers = room.match.teams[inn.bowlingTeam].players;
      const exists = teamPlayers.some(p => (typeof p === 'string' ? p : p?.name) === safeBowler);
      if (!exists) teamPlayers.push(safeBowler);
    }
    inn.currentBowler = inn.bowlers.findIndex(b => b.name === safeBowler);
    inn.awaitingNewBowler = false;  // clear the flag
    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    if (typeof cb === 'function') cb({ success: true });
  });

  // ─── Announcements ───────────────────────────────
  socket.on('announcement:add', ({ text }) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const safeText = sanitizeText(text, 280);
    if (!safeText) return;

    const me = getMe();
    const ann = { id: Date.now(), text: safeText, author: me?.name || 'Unknown', timestamp: new Date().toISOString() };
    room.match.announcements.unshift(ann);
    if (room.match.announcements.length > 50) room.match.announcements.pop();
    saveRooms();
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
    io.to(currentRoom).emit('planning:update', getRoomPublicState(room));
  });

  // ─── Chat ────────────────────────────────────────
  socket.on('chat:message', ({ text }) => {
    if (!currentRoom || !currentPhone) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Anti-spam rate limiting on chat: max 6 messages per 5s per user
    if (isRateLimited(`chat:${currentPhone}`, 6, 5000)) {
      return socket.emit('chat:error', { message: 'Slow down! Please wait a moment before sending more messages.' });
    }

    const safeText = sanitizeText(text, 400);
    if (!safeText) return;

    const me = getMe();
    const msg = {
      id: Date.now(),
      text: safeText,
      author: me?.name || 'Unknown',
      color: me?.color || '#fff',
      timestamp: new Date().toISOString()
    };
    room.match.chat.push(msg);
    if (room.match.chat.length > 200) room.match.chat.shift();
    saveRooms();
    io.to(currentRoom).emit('chat:message', msg);
  });

  // ─── Disconnect ──────────────────────────────────
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    delete room.sockets[socket.id];
    io.to(currentRoom).emit('planning:update', getRoomPublicState(room));
    io.to(currentRoom).emit('state:update', getRoomPublicState(room));
  });
});

const PORT = process.env.PORT || 3000;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is already in use by another instance!`);
    console.error(`👉 To free the port and restart, run: npm run kill-port && npm start\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});
server.listen(PORT, async () => {
  console.log(`🏏 CricketHub running in ${process.env.NODE_ENV || 'development'} mode at http://localhost:${PORT}`);
  await initCloudDatabase();
});

// ═══════════════════════════════════════════════
//  GRACEFUL SHUTDOWN & PROCESS CRASH PROTECTION
// ═══════════════════════════════════════════════
function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

  try {
    io.emit('server:shutdown', { message: 'Server is restarting for maintenance. Auto-reconnecting shortly...' });
  } catch (e) { }

  try {
    saveUsers();
    saveRooms();
    saveSubscriptions();
    console.log('💾 In-memory state safely persisted to disk.');
  } catch (err) {
    console.error('Failed to flush state during shutdown:', err);
  }

  server.close(() => {
    console.log('✅ HTTP server closed. Shutdown complete.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('⚠️ Forcefully exiting after shutdown timeout.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception thrown:', err);
  try {
    saveUsers();
    saveRooms();
    saveSubscriptions();
  } catch (e) { }
  process.exit(1);
});
