const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const SUBS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');
const MATCHES_DIR = path.join(DATA_DIR, 'matches');

const ROOM_TTL = 24 * 60 * 60 * 1000;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL = 5 * 60 * 1000;

const COLORS = [
  '#00e5ff', '#ff3d71', '#00d68f', '#ffaa00',
  '#a855f7', '#ec4899', '#3b82f6', '#10b981'
];

module.exports = {
  DATA_DIR,
  USERS_FILE,
  ROOMS_FILE,
  GROUPS_FILE,
  SUBS_FILE,
  MATCHES_DIR,
  ROOM_TTL,
  SESSION_TTL,
  OTP_TTL,
  COLORS
};
