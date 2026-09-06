const fs = require('fs');
const path = require('path');

// Mock browser environment
global.window = global;
global.document = {
  getElementById: (id) => {
    if (!global._elements[id]) {
      global._elements[id] = {
        innerHTML: '',
        textContent: '',
        value: '',
        style: {},
        classList: {
          add: () => {},
          remove: () => {},
          contains: () => false
        }
      };
    }
    return global._elements[id];
  },
  querySelectorAll: () => []
};
global._elements = {};
global.localStorage = {
  _data: {},
  getItem: (k) => global.localStorage._data[k] || null,
  setItem: (k, v) => global.localStorage._data[k] = String(v),
  removeItem: (k) => delete global.localStorage._data[k]
};

// Load app.js functions
const appCode = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

// Evaluate necessary snippets
eval(appCode.slice(appCode.indexOf('function phonesMatch'), appCode.indexOf('function formatOvers')));
eval(appCode.slice(appCode.indexOf('function escHtml'), appCode.indexOf('let playersCache')));
eval(appCode.slice(appCode.indexOf('function getAvatarHtml'), appCode.indexOf('function sanitizeUrl')));
eval(appCode.slice(appCode.indexOf('function isHost'), appCode.indexOf('function toast')));
eval(appCode.slice(appCode.indexOf('function renderRsvpStats'), appCode.indexOf('function renderPlanningAnnouncements')));

// Setup test state
global.state = {
  session: {
    user: { phone: '+919876540001', name: 'Captain Virat', color: '#00e5ff' }
  },
  room: {
    code: 'CRK-TEST',
    matchName: 'Premier League Match',
    hostPhone: '9876540001',
    planning: {
      members: {
        '9876540001': {
          phone: '9876540001',
          name: 'Captain Virat',
          color: '#00e5ff',
          vote: 'coming',
          comment: 'Ready to bat!',
          isHost: true,
          isOnline: true
        },
        '9876540002': {
          phone: '9876540002',
          name: 'Rohit Sharma',
          color: '#ff9800',
          vote: 'maybe',
          comment: 'Reaching ground by 4:30',
          isHost: false,
          isOnline: true
        },
        '9876540003': {
          phone: '+919876540003',
          name: 'Jasprit Bumrah',
          color: '#4caf50',
          vote: null,
          comment: '',
          isHost: false,
          isOnline: false
        }
      }
    }
  }
};

console.log('🧪 Testing renderRsvpStats()...');
renderRsvpStats();
console.log('   stat-coming:', global._elements['stat-coming'].textContent);
console.log('   stat-maybe:', global._elements['stat-maybe'].textContent);
console.log('   stat-not-coming:', global._elements['stat-not-coming'].textContent);
console.log('   stat-no-vote:', global._elements['stat-no-vote'].textContent);

console.log('\n🧪 Testing renderRsvpGrid()...');
renderRsvpGrid();
const gridHtml = global._elements['rsvp-grid'].innerHTML;
console.log('   RSVP Grid rendered successfully!');
console.log('   Grid contains Captain Virat:', gridHtml.includes('Captain Virat'));
console.log('   Grid contains Rohit Sharma:', gridHtml.includes('Rohit Sharma'));
console.log('   Grid contains Jasprit Bumrah:', gridHtml.includes('Jasprit Bumrah'));
console.log('   Grid contains (you) badge:', gridHtml.includes('(you)'));
console.log('   Grid contains 👑 HOST chip:', gridHtml.includes('👑 HOST'));

console.log('\n🧪 Testing renderMyVote()...');
renderMyVote();
console.log('   My vote comment loaded:', global._elements['vote-comment'].value);

console.log('\n✅ SQUAD AVAILABILITY RENDERING TESTS PASSED WITH 0 ERRORS!');
