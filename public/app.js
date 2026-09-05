/* ═══════════════════════════════════════════════
   CRICKETHUB — Client App v2
   Auth + Planning + Match Scoring
   ═══════════════════════════════════════════════ */

const socket = io();

// ── App State ──────────────────────────────────
const state = {
  session: null,    // { token, user: { phone, name, color } }
  room: null,       // full room state from server
  otpCountdown: null,
  pendingRuns: null,
  pendingExtras: {},
  pendingWicket: false,
  tossWinner: null,
};

// ── Session Persistence ────────────────────────
const SESSION_KEY = 'crickethub_session';

function saveSession(data) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  state.session = data;
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  state.session = null;
}

// ── Utilities ──────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function isHost() {
  let user = state.session?.user;
  if (!user) {
    try {
      const savedAuth = JSON.parse(localStorage.getItem('cricket_auth_user') || 'null');
      const savedSession = JSON.parse(localStorage.getItem('cricket_session') || 'null');
      user = savedAuth || savedSession?.user;
    } catch (_) {}
  }
  if (!user) return true; // allow interaction, validated on server
  const myPhone = user.phone;
  const hostPhone = state.room?.hostPhone;
  if (!hostPhone) return true;
  if (hostPhone && myPhone && hostPhone === myPhone) return true;
  if (hostPhone && myPhone) {
    const d1 = String(myPhone).replace(/\D/g, '');
    const d2 = String(hostPhone).replace(/\D/g, '');
    if (d1 && d2 && (d1 === d2 || d1.endsWith(d2) || d2.endsWith(d1) || d1.endsWith(d2.slice(-10)) || d2.endsWith(d1.slice(-10)))) return true;
  }
  const members = state.room?.planning?.members || {};
  if (myPhone && members[myPhone]?.isHost) return true;
  for (const m of Object.values(members)) {
    if (m?.isHost) {
      if (m.phone && myPhone && (m.phone === myPhone || String(m.phone).replace(/\D/g,'') === String(myPhone).replace(/\D/g,''))) return true;
      if (m.name && user.name && m.name.toLowerCase().trim() === user.name.toLowerCase().trim()) return true;
    }
  }
  return false;
}

function toast(msg, duration = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

function fmtTime(val) {
  if (!val) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (typeof val === 'string' && (/^\d{1,2}:\d{2}(\s?[APap][Mm])?$/.test(val.trim()) || /^\d{1,2}:\d{2}:\d{2}/.test(val.trim()))) {
    return val.trim();
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtPhone(phone) {
  // Show last 4 digits only for privacy in cards
  return '••••' + String(phone).slice(-4);
}

function formatOvers(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function calcRRR(target, runs, balls, totalBalls) {
  const remaining = target - runs;
  const ballsLeft = totalBalls - balls;
  if (ballsLeft <= 0) return '—';
  return ((remaining / ballsLeft) * 6).toFixed(2);
}

function getTeamName(match, key) {
  return match.teams[key]?.name || key;
}

function getPlayerList(match, teamKey) {
  const list = match?.teams?.[teamKey]?.players || [];
  let players = list.map(p => (typeof extractPlayerName === 'function' ? extractPlayerName(p) : (typeof p === 'string' ? p : (p?.name || p?.id || '')))).filter(Boolean);

  if (players.length === 0 && state?.room?.planning?.members) {
    const planningNames = Object.values(state.room.planning.members).map(m => m.name?.trim()).filter(Boolean);
    if (planningNames.length > 0) players = Array.from(new Set(planningNames));
  }
  return players;
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let playersCache = [];

function getAvatarHtml(avatar, name, color, size = 32) {
  const initial = (name || 'P')[0].toUpperCase();
  const bg = color || '#00e5ff';
  if (avatar && typeof avatar === 'string') {
    if (avatar.startsWith('data:') || avatar.startsWith('http:') || avatar.startsWith('https:') || avatar.startsWith('/') || avatar.startsWith('blob:')) {
      return `<img src="${avatar}" class="avatar-img-cover" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${escHtml(name || 'Player')}" onerror="this.parentElement.innerHTML='<span style=\\'display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-weight:700;color:#000;background:${bg}\\'>${initial}</span>'" />`;
    }
    if (avatar.length <= 4 && !avatar.includes('.')) {
      return `<span style="font-size:${Math.round(size * 0.55)}px;line-height:1">${avatar}</span>`;
    }
  }
  return `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-weight:800;font-size:${Math.round(size * 0.45)}px;color:#000;background:${bg};border-radius:50%">${initial}</span>`;
}
window.getAvatarHtml = getAvatarHtml;

function getAvatarBg(avatar, color) {
  if (avatar && typeof avatar === 'string' && (avatar.startsWith('data:') || avatar.startsWith('http:') || avatar.startsWith('https:') || avatar.startsWith('/') || avatar.startsWith('blob:'))) {
    return 'transparent';
  }
  return color || '#00e5ff';
}
window.getAvatarBg = getAvatarBg;

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '';
}

// ══════════════════════════════════════════════
//  SCREEN 1 — AUTH
// ══════════════════════════════════════════════

// ── Global User Registration on Socket ────────
function registerSocketUser() {
  if (state.session?.token && state.session?.user?.phone) {
    socket.emit('user:register', {
      token: state.session.token,
      phone: state.session.user.phone
    });
  }
}

socket.on('connect', () => {
  registerSocketUser();
  if (state.room?.code && state.session?.token) {
    socket.emit('room:join', { token: state.session.token, code: state.room.code }, () => { });
  }
});

// Try to restore session on load
async function init() {
  const saved = loadSession();
  if (saved?.token) {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: saved.token })
      });
      const data = await res.json();
      if (data.success) {
        state.session = { token: saved.token, user: data.user };
        saveSession(state.session);
        registerSocketUser();

        // Check if opened via URL query ?room=CRK-XXXX
        const urlParams = new URLSearchParams(window.location.search);
        const roomFromUrl = urlParams.get('room');
        if (roomFromUrl) {
          joinRoomDirect(roomFromUrl);
          return;
        }

        showHomeScreen();
        return;
      }
    } catch { /* network error, stay on auth */ }
  }
  showScreen('screen-auth');
}

let currentAuthMode = 'login'; // 'login' | 'signup'

window.setAuthMode = function (mode) {
  currentAuthMode = mode;
  const loginTab = document.getElementById('auth-tab-login');
  const signupTab = document.getElementById('auth-tab-signup');
  const title = document.getElementById('auth-title');
  const sub = document.getElementById('auth-subtitle');
  const nameGroup = document.getElementById('auth-group-name');
  const btnText = document.getElementById('btn-send-otp-text');

  if (mode === 'signup') {
    if (loginTab) loginTab.classList.remove('active');
    if (signupTab) signupTab.classList.add('active');
    if (title) title.textContent = 'Join CricketHub Squad! 🏏';
    if (sub) sub.textContent = 'Create your player profile in seconds';
    if (nameGroup) nameGroup.style.display = 'block';
    if (btnText) btnText.textContent = 'Create Profile & Send OTP 🚀';
    document.getElementById('auth-name')?.focus();
  } else {
    if (loginTab) loginTab.classList.add('active');
    if (signupTab) signupTab.classList.remove('active');
    if (title) title.textContent = 'Welcome Back! 🏏';
    if (sub) sub.textContent = 'Enter your mobile number to receive your login OTP';
    if (nameGroup) nameGroup.style.display = 'none';
    if (btnText) btnText.textContent = 'Send Login OTP 📲';
    document.getElementById('auth-phone')?.focus();
  }
};

// ── Phone Step ────────────────────────────────
document.getElementById('btn-send-otp').addEventListener('click', sendOtp);
document.getElementById('auth-phone').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendOtp();
});
document.getElementById('auth-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('auth-phone').focus();
});

async function sendOtp() {
  const nameInput = document.getElementById('auth-name');
  const name = nameInput?.value.trim() || '';
  const cc = document.getElementById('auth-country-code')?.value || '91';
  const rawPhone = (document.getElementById('auth-phone')?.value || '').trim().replace(/\D/g, '');

  if (currentAuthMode === 'signup' && !name) {
    if (nameInput) nameInput.focus();
    return toast('👤 Please enter your Player Name to Sign Up');
  }

  if (!rawPhone || rawPhone.length < 8) {
    document.getElementById('auth-phone')?.focus();
    return toast('📱 Please enter a valid 10-digit mobile number');
  }

  // Handle duplicate country code if typed by user
  let cleanPhone = rawPhone;
  if (cleanPhone.startsWith(cc) && cleanPhone.length > 10) {
    cleanPhone = cleanPhone.slice(cc.length);
  } else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
    cleanPhone = cleanPhone.slice(1);
  }
  const full = cc + cleanPhone;

  const btn = document.getElementById('btn-send-otp');
  const btnText = document.getElementById('btn-send-otp-text');
  if (btnText) btnText.textContent = 'Sending code…';
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: full, name, mode: currentAuthMode })
    });
    const data = await res.json();

    if (!data.success) {
      if (data.notFound && currentAuthMode === 'login') {
        toast('ℹ️ ' + data.error);
        setAuthMode('signup');
        if (nameInput) nameInput.focus();
        if (btnText) btnText.textContent = 'Create Profile & Send OTP 🚀';
        if (btn) btn.disabled = false;
        return;
      }
      if (data.alreadyExists && currentAuthMode === 'signup') {
        toast('ℹ️ ' + data.error);
        setAuthMode('login');
        if (btnText) btnText.textContent = 'Send Login OTP 📲';
        if (btn) btn.disabled = false;
        return;
      }
      toast('❌ ' + data.error);
      if (btnText) btnText.textContent = currentAuthMode === 'signup' ? 'Create Profile & Send OTP 🚀' : 'Send Login OTP 📲';
      if (btn) btn.disabled = false;
      return;
    }

    // Update dev OTP banner inside OTP verification card
    const banner = document.getElementById('dev-otp-banner');
    if (banner) {
      banner.style.display = data.devOtp ? 'block' : 'none';
      const codeEl = document.getElementById('dev-otp-code');
      if (codeEl) codeEl.textContent = data.devOtp || '------';
    }

    const infoEl = document.getElementById('otp-resend-info');
    if (infoEl) {
      infoEl.textContent = `OTP Request ${data.requestCount || 1}/5 · ${data.requestsRemaining !== undefined ? data.requestsRemaining + ' remaining in this session' : ''}`;
    }

    // Switch to OTP step
    document.getElementById('auth-step-phone').style.display = 'none';
    document.getElementById('auth-step-otp').style.display = 'flex';
    const masked = data.maskedPhone || `+${full.slice(0, 2)} ••••• ••${full.slice(-3)}`;
    document.getElementById('otp-sent-to').textContent = `Code sent to ${masked}`;

    // Pre-fill inputs with dev OTP automatically for instant 1-click verification
    if (data.devOtp) {
      const cleanDigits = String(data.devOtp).replace(/\D/g, '').slice(0, 6);
      for (let i = 0; i < 6; i++) {
        const el = document.getElementById(`otp-${i}`);
        if (el) el.value = cleanDigits[i] || '';
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const el = document.getElementById(`otp-${i}`);
        if (el) el.value = '';
      }
    }
    document.getElementById('otp-0')?.focus();
    startOtpCountdown(5 * 60);

    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = currentAuthMode === 'signup' ? 'Create Profile & Send OTP 🚀' : 'Send Login OTP 📲';
  } catch (err) {
    console.error('Error sending OTP:', err);
    toast('❌ Network error. Is the server running?');
    if (btnText) btnText.textContent = currentAuthMode === 'signup' ? 'Create Profile & Send OTP 🚀' : 'Send Login OTP 📲';
    if (btn) btn.disabled = false;
  }
}

// ── In-place Resend OTP ────────────────────────
async function resendOtp() {
  const name = document.getElementById('auth-name')?.value.trim() || '';
  const cc = document.getElementById('auth-country-code')?.value || '91';
  const rawPhone = (document.getElementById('auth-phone')?.value || '').trim().replace(/\D/g, '');

  let cleanPhone = rawPhone;
  if (cleanPhone.startsWith(cc) && cleanPhone.length > 10) {
    cleanPhone = cleanPhone.slice(cc.length);
  } else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
    cleanPhone = cleanPhone.slice(1);
  }
  const full = cc + cleanPhone;

  const resendBtn = document.getElementById('btn-resend-otp');
  if (resendBtn) {
    resendBtn.disabled = true;
    resendBtn.textContent = 'Requesting new OTP…';
  }

  try {
    const res = await fetch('/api/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: full, name, mode: currentAuthMode })
    });
    const data = await res.json();

    if (!data.success) {
      toast('❌ ' + data.error);
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.textContent = '📲 Resend OTP';
      }
      return;
    }

    // Update dev banner
    const banner = document.getElementById('dev-otp-banner');
    if (banner) {
      banner.style.display = data.devOtp ? 'block' : 'none';
      const codeEl = document.getElementById('dev-otp-code');
      if (codeEl) codeEl.textContent = data.devOtp || '------';
    }

    // Auto populate inputs with new OTP
    if (data.devOtp) {
      const cleanDigits = String(data.devOtp).replace(/\D/g, '').slice(0, 6);
      for (let i = 0; i < 6; i++) {
        const el = document.getElementById(`otp-${i}`);
        if (el) el.value = cleanDigits[i] || '';
      }
    }

    const infoEl = document.getElementById('otp-resend-info');
    if (infoEl) {
      infoEl.textContent = `OTP Request ${data.requestCount || 1}/5 · ${data.requestsRemaining !== undefined ? data.requestsRemaining + ' remaining in this session' : ''}`;
    }

    toast(`📲 New OTP requested! (Request ${data.requestCount}/5)`);
    clearOtpCountdown();
    startOtpCountdown(5 * 60);
    document.getElementById('otp-0')?.focus();

    if (resendBtn) {
      resendBtn.disabled = false;
      resendBtn.textContent = '📲 Resend OTP';
    }
  } catch (err) {
    console.error('Error resending OTP:', err);
    toast('❌ Network error while requesting OTP');
    if (resendBtn) {
      resendBtn.disabled = false;
      resendBtn.textContent = '📲 Resend OTP';
    }
  }
}

// ── 1-Click Autofill Dev OTP ───────────────────
window.autofillDevOtp = function () {
  const codeEl = document.getElementById('dev-otp-code');
  const raw = codeEl?.textContent || '';
  const code = raw.replace(/\D/g, '').slice(0, 6);
  if (!code || code.length < 6) return;
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById(`otp-${i}`);
    if (el) el.value = code[i] || '';
  }
  toast('✨ Auto-filled dev OTP: ' + code);
  setTimeout(verifyOtp, 150);
};

// ── OTP Digit Inputs ──────────────────────────
document.querySelectorAll('.otp-digit').forEach((input, idx) => {
  input.addEventListener('input', (e) => {
    // Allow only digits
    input.value = input.value.replace(/\D/g, '').slice(0, 1);
    if (input.value && idx < 5) {
      document.getElementById(`otp-${idx + 1}`).focus();
    }
    if (idx === 5 && input.value) {
      // Auto-verify on last digit
      setTimeout(verifyOtp, 150);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && idx > 0) {
      document.getElementById(`otp-${idx - 1}`).focus();
    }
    if (e.key === 'Enter') verifyOtp();
  });
  // Handle paste
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
    [...pasted].slice(0, 6).forEach((ch, i) => {
      const el = document.getElementById(`otp-${i}`);
      if (el) el.value = ch;
    });
    const nextEmpty = Math.min(pasted.length, 5);
    document.getElementById(`otp-${nextEmpty}`)?.focus();
    if (pasted.length >= 6) setTimeout(verifyOtp, 150);
  });
});

function backToPhoneStep() {
  clearOtpCountdown();
  document.getElementById('auth-step-otp').style.display = 'none';
  document.getElementById('auth-step-phone').style.display = 'flex';
  const btn = document.getElementById('btn-send-otp');
  const btnText = document.getElementById('btn-send-otp-text');
  if (btnText) btnText.textContent = currentAuthMode === 'signup' ? 'Create Profile & Send OTP 🚀' : 'Send Login OTP 📲';
  if (btn) btn.disabled = false;
}

document.getElementById('btn-back-to-phone')?.addEventListener('click', backToPhoneStep);
document.getElementById('btn-verify-otp')?.addEventListener('click', verifyOtp);
document.getElementById('btn-resend-otp')?.addEventListener('click', resendOtp);

window.sendOtp = sendOtp;
window.verifyOtp = verifyOtp;
window.resendOtp = resendOtp;
window.backToPhoneStep = backToPhoneStep;

let isVerifyingOtp = false;

async function verifyOtp() {
  if (isVerifyingOtp) return;
  let otp = [0, 1, 2, 3, 4, 5].map(i => document.getElementById(`otp-${i}`)?.value || '').join('').replace(/\D/g, '');
  
  // Smart fallback: if inputs were somehow empty, check dev-otp-code banner
  if (otp.length < 6) {
    const devCode = document.getElementById('dev-otp-code')?.textContent?.replace(/\D/g, '').slice(0, 6);
    if (devCode && devCode.length === 6) {
      otp = devCode;
      for (let i = 0; i < 6; i++) {
        const el = document.getElementById(`otp-${i}`);
        if (el) el.value = devCode[i];
      }
    }
  }

  if (otp.length < 6) return toast('Please enter all 6 digits');

  const cc = document.getElementById('auth-country-code')?.value || '91';
  const rawPhone = (document.getElementById('auth-phone')?.value || '').trim().replace(/\D/g, '');
  let cleanPhone = rawPhone;
  if (cleanPhone.startsWith(cc) && cleanPhone.length > 10) {
    cleanPhone = cleanPhone.slice(cc.length);
  } else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
    cleanPhone = cleanPhone.slice(1);
  }
  const full = cc + cleanPhone;

  const btn = document.getElementById('btn-verify-otp');
  if (btn) {
    btn.textContent = 'Verifying…';
    btn.disabled = true;
  }
  isVerifyingOtp = true;

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: full, otp })
    });
    const data = await res.json();

    if (!data.success) {
      toast('❌ ' + (data.error || 'Verification failed'));
      if (btn) {
        btn.textContent = 'Verify & Continue ✅';
        btn.disabled = false;
      }

      // Shake the inputs
      document.getElementById('otp-inputs')?.animate(
        [{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
        { duration: 300, iterations: 2 }
      );

      // Clear the digit fields and focus first digit for instant re-try
      for (let i = 0; i < 6; i++) {
        const el = document.getElementById(`otp-${i}`);
        if (el) el.value = '';
      }
      document.getElementById('otp-0')?.focus();
      return;
    }

    clearOtpCountdown();
    saveSession({ token: data.token, user: data.user });
    toast(`🏏 Welcome, ${data.user.name}!`);
    showHomeScreen();
  } catch (err) {
    console.error('Error verifying OTP:', err);
    toast('❌ Network error during verification.');
  } finally {
    isVerifyingOtp = false;
    if (btn) {
      btn.textContent = 'Verify & Continue ✅';
      btn.disabled = false;
    }
  }
}

// OTP Countdown Timer
function startOtpCountdown(seconds) {
  let remaining = seconds;
  const el = document.getElementById('otp-countdown');

  function tick() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (remaining <= 0) {
      el.textContent = 'Expired';
      el.style.color = 'var(--danger)';
      clearInterval(state.otpCountdown);
      return;
    }
    remaining--;
  }
  tick();
  state.otpCountdown = setInterval(tick, 1000);
}

function clearOtpCountdown() {
  if (state.otpCountdown) {
    clearInterval(state.otpCountdown);
    state.otpCountdown = null;
  }
}

// ── Service Worker & Web Push Registration ─────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  if (!state.session?.user?.phone) return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const res = await fetch('/api/push/vapid-public-key');
    const { publicKey } = await res.json();
    if (!publicKey) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: state.session.user.phone,
        subscription: sub
      })
    });
    console.log('✅ W3C OS-level Push subscription active on server');
    return true;
  } catch (err) {
    console.warn('Push subscription error:', err);
    return false;
  }
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    console.log('CricketHub SW registered:', reg.scope);
    if ('Notification' in window && Notification.permission === 'granted') {
      subscribePushNotifications();
    }
  }).catch(err => {
    console.warn('SW registration error:', err);
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'OPEN_ROOM' && event.data?.roomCode) {
      joinRoomDirect(event.data.roomCode, event.data.autoVote || null);
    }
  });
}

function checkNotificationPermissionBanner() {
  const banner = document.getElementById('home-notif-banner');
  const textEl = document.getElementById('home-notif-text');
  const actEl = document.getElementById('home-notif-actions');
  if (!banner || !textEl || !actEl) return;

  banner.style.display = 'flex';

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  // Check if browser has Notification API
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      banner.style.display = 'none';
      subscribePushNotifications();
      return;
    } else {
      // Prompt user to enable notifications (triggers native iOS / Android dialog)
      banner.style.display = 'flex';
      textEl.innerHTML = '🔔 <strong>Push Notifications:</strong> Enable alerts to receive match invitations and squad pings on your lockscreen!';
      actEl.innerHTML = '<button class="btn btn-primary btn-sm" id="btn-enable-notifs" style="white-space:nowrap">Enable Alerts 🔔</button>';
      document.getElementById('btn-enable-notifs')?.addEventListener('click', enableNotificationsHandler);
      return;
    }
  }

  // If Notification API is not available on this browser wrapper
  if (isIOS && !isStandalone) {
    textEl.innerHTML = '🍎 <strong>iPhone Setup:</strong> Tap <strong>Share (⬆️) → Add to Home Screen</strong> to enable background push alerts!';
    actEl.innerHTML = '<button class="btn btn-secondary btn-sm" id="btn-ios-guide" style="white-space:nowrap">How-To 📲</button>';
    document.getElementById('btn-ios-guide')?.addEventListener('click', () => {
      document.getElementById('ios-guide-modal').style.display = 'flex';
    });
    return;
  }

  textEl.innerHTML = '📲 <strong>Notice:</strong> Browser does not support Web Push notifications. Alerts will appear in the app.';
  actEl.innerHTML = '';
}

document.getElementById('btn-close-ios-guide')?.addEventListener('click', () => {
  document.getElementById('ios-guide-modal').style.display = 'none';
});

document.getElementById('ios-guide-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'ios-guide-modal') {
    document.getElementById('ios-guide-modal').style.display = 'none';
  }
});

async function enableNotificationsHandler() {
  if (!('Notification' in window)) return toast('Browser does not support notifications');
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      toast('🔔 OS Push Notifications enabled!');
      await subscribePushNotifications();
      triggerPushNotification({
        title: '🏏 CricketHub Alerts Enabled',
        message: 'You will now receive match alerts even when your phone is idle or using other apps!'
      });
    } else if (permission === 'denied') {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIOS && window.location.protocol === 'http:') {
        toast('⚠️ iPhone requires an HTTPS link (https://...) for lockscreen push notifications');
      } else {
        toast('⚠️ Notifications blocked by browser. Please use HTTPS link or allow in settings.');
      }
    }
    checkNotificationPermissionBanner();
  } catch (e) { console.warn(e); }
}

async function triggerPushNotification(alertData) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const sched = formatMatchSchedule(alertData.date, alertData.time);
  const title = alertData.title || '⚡ Cricket Match Alert!';
  const bodyText = `${alertData.message || 'Squad match alert'}${alertData.matchName ? '\nMatch: ' + alertData.matchName : ''}${sched ? ' (' + sched + ')' : ''}`;

  const options = {
    body: bodyText,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200, 100, 200],
    tag: 'match-alert-' + (alertData.roomCode || alertData.id || Date.now()),
    data: {
      roomCode: alertData.roomCode || null,
      url: window.location.origin
    }
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        reg.showNotification(title, options);
        return;
      }
    }
  } catch (e) { }

  try {
    const notif = new Notification(title, options);
    notif.onclick = () => {
      window.focus();
      if (alertData.roomCode) joinRoomDirect(alertData.roomCode);
    };
  } catch (e) {
    console.warn('Native notification error:', e);
  }
}

// ══════════════════════════════════════════════
//  SCREEN 2 — HOME
// ══════════════════════════════════════════════
function showHomeScreen() {
  const user = state.session?.user;
  if (!user) { showScreen('screen-auth'); return; }

  showScreen('screen-home');
  document.getElementById('home-greeting').textContent = `Hey, ${user.name}! 👋`;
  updateAllUserBadges();

  registerSocketUser();
  checkNotificationPermissionBanner();

  // Active saved room resume banner
  const activeBanner = document.getElementById('home-active-room-banner');
  if (activeBanner) {
    const savedRoom = state.room;
    const lastRoomCode = localStorage.getItem('cricket_last_room');
    if (savedRoom && savedRoom.code) {
      activeBanner.style.display = 'flex';
      const nameEl = document.getElementById('home-active-room-name');
      const codeEl = document.getElementById('home-active-room-code');
      const subEl = document.getElementById('home-active-room-sub');
      const badgeEl = activeBanner.querySelector('.active-room-status-badge');
      const matchStatus = savedRoom.match?.status || 'planning';

      if (nameEl) nameEl.textContent = savedRoom.matchName || 'Match Planning';
      if (codeEl) codeEl.textContent = savedRoom.code;
      if (badgeEl) {
        badgeEl.textContent = matchStatus === 'planning' ? 'Planning In Progress (Saved)' : (matchStatus === 'setup' ? 'Match Setup (Saved)' : 'Live Match Active');
      }
      if (subEl) {
        const memberCount = Object.keys(savedRoom.planning?.members || {}).length;
        subEl.textContent = matchStatus === 'planning'
          ? `Planning in progress • ${memberCount} squad members registered`
          : (matchStatus === 'setup' ? 'Match configuration in progress' : 'Live match scoring in progress');
      }
    } else if (lastRoomCode) {
      activeBanner.style.display = 'flex';
      const nameEl = document.getElementById('home-active-room-name');
      const codeEl = document.getElementById('home-active-room-code');
      const subEl = document.getElementById('home-active-room-sub');
      if (nameEl) nameEl.textContent = 'Recent Match';
      if (codeEl) codeEl.textContent = lastRoomCode;
      if (subEl) subEl.textContent = 'Saved on this device • Click to rejoin and sync';
    } else {
      activeBanner.style.display = 'none';
    }
  }
}

window.leavePlanningToHome = function () {
  showHomeScreen();
  toast('💾 Match planning saved! You can return anytime.');
};

window.leaveLobbyToHome = function () {
  showHomeScreen();
  toast('💾 Match saved! You can return anytime.');
};

window.resumeActiveRoom = function () {
  if (!state.room || !state.room.code) {
    const lastCode = localStorage.getItem('cricket_last_room');
    if (lastCode) {
      joinRoomDirect(lastCode);
      return;
    }
    toast('No active match room found');
    return;
  }

  const matchStatus = state.room.match?.status || 'planning';
  if (matchStatus === 'planning') {
    showPlanningScreen();
    toast(`🏏 Returned to ${state.room.matchName || state.room.code}`);
  } else {
    enterLobby();
    toast(`🏏 Returned to ${state.room.matchName || state.room.code}`);
  }
};

window.logoutUser = function () {
  clearOtpCountdown();
  clearSession();
  state.room = null;
  localStorage.removeItem('cricket_last_room');

  // Close all open modals cleanly
  ['player-profile-modal', 'players-directory-modal', 'camera-capture-modal', 'photo-picker-modal', 'scorecard-modal', 'toss-modal', 'share-modal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Switch to auth screen in login mode
  showScreen('screen-auth');
  setAuthMode('login');

  document.getElementById('auth-step-phone').style.display = 'flex';
  document.getElementById('auth-step-otp').style.display = 'none';
  const banner = document.getElementById('dev-otp-banner');
  if (banner) banner.style.display = 'none';

  const btn = document.getElementById('btn-send-otp');
  const btnText = document.getElementById('btn-send-otp-text');
  if (btnText) btnText.textContent = 'Send Login OTP 📲';
  if (btn) btn.disabled = false;

  toast('👋 Logged out successfully');
};

document.getElementById('btn-logout')?.addEventListener('click', logoutUser);

document.getElementById('btn-home-create').addEventListener('click', () => {
  const matchName = document.getElementById('home-match-name').value.trim();
  if (!matchName) return toast('Please enter a match name');
  if (!state.session?.token) return toast('Not logged in');

  socket.emit('room:create', { token: state.session.token, matchName }, (res) => {
    if (!res.success) return toast('❌ ' + res.error);
    state.room = res.room;
    localStorage.setItem('cricket_last_room', res.room.code);
    showPlanningScreen();
    toast(`✅ Room created! Code: ${res.room.code}`);
  });
});

document.getElementById('btn-home-join').addEventListener('click', joinRoom);
document.getElementById('home-join-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});
document.getElementById('home-match-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-home-create').click();
});

document.getElementById('btn-open-history')?.addEventListener('click', () => {
  openHistoryScreen();
});

// Home Screen Broadcast Alert
document.getElementById('btn-home-broadcast-alert')?.addEventListener('click', async () => {
  const input = document.getElementById('home-broadcast-msg');
  const msg = input?.value.trim();
  const userName = state.session?.user?.name || 'A player';
  const btn = document.getElementById('btn-home-broadcast-alert');
  if (btn) btn.disabled = true;

  toast('🚀 Dispatching match alert to all registered phones...');
  try {
    const res = await fetch('/api/push/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.session?.token,
        author: userName,
        message: msg || `⚡ ${userName} is pinging everyone for a cricket match! Tap to open CricketHub.`
      })
    });
    const data = await res.json();
    if (data.success) {
      toast(`📲 Match alert delivered to ${data.total || 'all'} player device(s)!`);
      if (input) input.value = '';
    } else {
      toast('❌ Error: ' + (data.error || 'Failed to send alert'));
    }
  } catch (e) {
    toast('❌ Network error: ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('home-broadcast-msg')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-home-broadcast-alert')?.click();
});

function joinRoomDirect(code, autoVote = null) {
  if (!code) return;
  const cleanCode = code.trim().toUpperCase();
  if (!state.session?.token) {
    showScreen('screen-auth');
    toast('Please log in first to view match');
    return;
  }

  socket.emit('room:join', { token: state.session.token, code: cleanCode }, (res) => {
    if (!res.success) return toast('❌ ' + res.error);
    state.room = res.room;
    localStorage.setItem('cricket_last_room', res.room.code);

    // Retain and route to the correct saved match phase
    const matchStatus = res.room.match?.status || 'planning';
    if (matchStatus !== 'planning') {
      enterLobby();
    } else {
      showPlanningScreen();
    }

    if (autoVote) {
      setTimeout(() => {
        socket.emit('planning:vote', { vote: autoVote });
        toast(`✅ Confirmed: ${autoVote === 'coming' ? 'Coming!' : autoVote}`);
      }, 350);
    }
  });
}

function joinRoom() {
  const code = document.getElementById('home-join-code').value.trim().toUpperCase();
  if (!code) return toast('Please enter a room code');
  joinRoomDirect(code);
}

// ══════════════════════════════════════════════
//  SCREEN 3 — PLANNING / RSVP
// ══════════════════════════════════════════════
function showPlanningScreen() {
  showScreen('screen-planning');
  loadUserGroups().then(() => renderPlanningGroupSection());
  renderPlanningScreen();
}

function renderPlanningScreen() {
  const { room, session } = state;
  if (!room || !session) return;

  // Header
  document.getElementById('planning-room-code').textContent = room.code;
  document.getElementById('planning-match-name').textContent = room.matchName;

  // User badge
  updateAllUserBadges();

  renderRsvpStats();
  renderPlanningGroupSection();
  renderRsvpGrid();
  renderMyVote();
  renderPlanningSchedule();
  renderPlanningAnnouncements();
  renderPlanningLocation();
  renderPlanningChat();

  // Host proceed button
  const hostUser = isHost();
  const proceedBtn = document.getElementById('btn-proceed-setup');
  if (proceedBtn) proceedBtn.style.display = hostUser ? 'block' : 'none';
  const pingPanel = document.getElementById('host-ping-panel');
  if (pingPanel) pingPanel.style.display = 'block'; // Any squad member can alert the squad

  // Non-host: show "View Scoreboard" when match is beyond planning
  let viewBtn = document.getElementById('btn-view-scoreboard');
  if (!hostUser && room.match?.status && room.match.status !== 'planning') {
    if (!viewBtn) {
      viewBtn = document.createElement('button');
      viewBtn.id = 'btn-view-scoreboard';
      viewBtn.className = 'btn btn-primary btn-lg';
      viewBtn.innerHTML = '📊 View Scoreboard';
      viewBtn.style.marginTop = '0.75rem';
      viewBtn.onclick = () => enterLobby();
      document.getElementById('btn-proceed-setup').insertAdjacentElement('afterend', viewBtn);
    }
  } else if (viewBtn) {
    viewBtn.remove();
  }
}

// ══════════════════════════════════════════════
//  CRICKET SQUAD & GROUPS LOGIC
// ══════════════════════════════════════════════

state.myGroups = [];

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
window.closeModal = closeModal;

async function loadUserGroups() {
  if (!state.session?.token) return [];
  try {
    const res = await fetch(`/api/groups?token=${encodeURIComponent(state.session.token)}`);
    const data = await res.json();
    state.myGroups = data.groups || [];
    return state.myGroups;
  } catch (err) {
    console.error('Failed to load user groups:', err);
    return [];
  }
}
window.loadUserGroups = loadUserGroups;

function renderPlanningGroupSection() {
  const room = state.room;
  if (!room) return;

  const activePanel = document.getElementById('planning-group-active');
  const nonePanel = document.getElementById('planning-group-none');
  const selectWrap = document.getElementById('planning-group-select-wrap');
  const quickSelect = document.getElementById('planning-group-quick-select');

  if (room.groupId && (room.group || room.groupName)) {
    if (activePanel) activePanel.style.display = 'block';
    if (nonePanel) nonePanel.style.display = 'none';

    const gName = room.group?.name || room.groupName || 'Cricket Squad';
    const gCode = room.group?.code || 'GRP-SQUAD';
    const gDesc = room.group?.description || 'Private Playing Squad';
    const memberCount = Array.isArray(room.group?.members) ? room.group.members.length : Object.keys(room.planning?.members || {}).length;

    const nameEl = document.getElementById('planning-active-group-name');
    if (nameEl) nameEl.textContent = gName;
    const codeEl = document.getElementById('planning-group-code-badge');
    if (codeEl) codeEl.textContent = gCode;
    const descEl = document.getElementById('planning-active-group-desc');
    if (descEl) descEl.textContent = gDesc;
    const countEl = document.getElementById('planning-group-member-count');
    if (countEl) countEl.textContent = `${memberCount} squad member${memberCount !== 1 ? 's' : ''}`;
    const hostEl = document.getElementById('planning-group-host-name');
    if (hostEl) hostEl.textContent = isHost() ? 'Captain: You (Host)' : `Captain: ${room.group?.hostName || 'Organizer'}`;

    // Host only can switch squad
    const switchBtn = document.getElementById('btn-switch-group');
    if (switchBtn) switchBtn.style.display = isHost() ? 'inline-block' : 'none';
  } else {
    if (activePanel) activePanel.style.display = 'none';
    if (nonePanel) nonePanel.style.display = 'block';

    // Populate quick select if user has groups
    if (Array.isArray(state.myGroups) && state.myGroups.length > 0 && isHost()) {
      if (selectWrap) selectWrap.style.display = 'block';
      if (quickSelect) {
        quickSelect.innerHTML = `<option value="">-- Choose from Your Squads (${state.myGroups.length}) --</option>` +
          state.myGroups.map(g => `<option value="${escHtml(g.id)}">${escHtml(g.name)} (${g.code})</option>`).join('');
      }
    } else if (selectWrap) {
      selectWrap.style.display = 'none';
    }
  }
}
window.renderPlanningGroupSection = renderPlanningGroupSection;

function copyActiveGroupCode() {
  const code = document.getElementById('planning-group-code-badge')?.textContent?.trim() || state.room?.group?.code;
  if (!code) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code);
    toast(`📋 Group Code "${code}" copied to clipboard! Share with teammates.`);
  } else {
    toast(`📋 Group Code: ${code}`);
  }
}
window.copyActiveGroupCode = copyActiveGroupCode;

function openCreateGroupModal() {
  closeModal('group-selector-modal');
  closeModal('group-join-modal');
  const modal = document.getElementById('group-create-modal');
  if (modal) {
    modal.style.display = 'flex';
    const nameInput = document.getElementById('group-create-name');
    const descInput = document.getElementById('group-create-desc');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    setTimeout(() => nameInput?.focus(), 50);
  }
}
window.openCreateGroupModal = openCreateGroupModal;

async function submitCreateGroup() {
  const name = document.getElementById('group-create-name')?.value?.trim();
  const desc = document.getElementById('group-create-desc')?.value?.trim();
  if (!name) return toast('⚠️ Please enter a Squad / Group name');

  const btn = document.getElementById('btn-submit-create-group');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating Squad…'; }

  try {
    const res = await fetch('/api/groups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.session.token}` },
      body: JSON.stringify({
        name,
        description: desc,
        creatorPhone: state.session.user.phone,
        creatorName: state.session.user.name,
        token: state.session.token
      })
    });
    const data = await res.json();
    if (!data.success) {
      toast('❌ ' + (data.error || 'Failed to create squad'));
      if (btn) { btn.disabled = false; btn.textContent = '🏏 Create Squad & Link Match'; }
      return;
    }

    const newGroup = data.group;
    state.myGroups.push(newGroup);
    closeModal('group-create-modal');

    // Automatically link to current room if in planning
    if (state.room?.code) {
      socket.emit('room:setGroup', { groupId: newGroup.id }, () => {
        toast(`🏆 Squad "${newGroup.name}" created and linked to this match! Code: ${newGroup.code}`);
      });
    } else {
      toast(`🏆 Squad "${newGroup.name}" created! Invite code: ${newGroup.code}`);
    }
  } catch (err) {
    console.error('Error creating group:', err);
    toast('❌ Network error while creating squad.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🏏 Create Squad & Link Match'; }
  }
}
window.submitCreateGroup = submitCreateGroup;

function openJoinGroupModal() {
  closeModal('group-selector-modal');
  closeModal('group-create-modal');
  const modal = document.getElementById('group-join-modal');
  if (modal) {
    modal.style.display = 'flex';
    const codeInput = document.getElementById('group-join-code-input');
    if (codeInput) codeInput.value = '';
    setTimeout(() => codeInput?.focus(), 50);
  }
}
window.openJoinGroupModal = openJoinGroupModal;

async function submitJoinGroup() {
  const code = document.getElementById('group-join-code-input')?.value?.trim().toUpperCase();
  if (!code) return toast('⚠️ Please enter the Squad invite code');

  const btn = document.getElementById('btn-submit-join-group');
  if (btn) { btn.disabled = true; btn.textContent = 'Joining Squad…'; }

  try {
    const res = await fetch('/api/groups/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.session.token}` },
      body: JSON.stringify({
        code,
        phone: state.session.user.phone,
        name: state.session.user.name,
        token: state.session.token
      })
    });
    const data = await res.json();
    if (!data.success) {
      toast('❌ ' + (data.error || 'Invalid squad invite code'));
      if (btn) { btn.disabled = false; btn.textContent = '🎯 Join Squad'; }
      return;
    }

    const group = data.group;
    if (!state.myGroups.some(g => g.id === group.id)) {
      state.myGroups.push(group);
    }
    closeModal('group-join-modal');

    if (state.room?.code && isHost()) {
      socket.emit('room:setGroup', { groupId: group.id }, () => {
        toast(`🎯 Joined squad "${group.name}" and linked to match!`);
      });
    } else {
      toast(`🎯 Successfully joined squad "${group.name}"!`);
      loadUserGroups().then(() => renderPlanningGroupSection());
    }
  } catch (err) {
    console.error('Error joining group:', err);
    toast('❌ Network error while joining squad.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎯 Join Squad'; }
  }
}
window.submitJoinGroup = submitJoinGroup;

function openAddGroupMemberModal() {
  const modal = document.getElementById('group-add-member-modal');
  if (modal) {
    modal.style.display = 'flex';
    const nameInput = document.getElementById('group-add-member-name');
    const phoneInput = document.getElementById('group-add-member-phone');
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    setTimeout(() => nameInput?.focus(), 50);
  }
}
window.openAddGroupMemberModal = openAddGroupMemberModal;

async function submitAddGroupMember() {
  const name = document.getElementById('group-add-member-name')?.value?.trim();
  const rawPhone = document.getElementById('group-add-member-phone')?.value?.trim();
  const role = document.getElementById('group-add-member-role')?.value || 'All-Rounder';

  if (!name) return toast('👤 Please enter player name');
  if (!rawPhone || rawPhone.length < 8) return toast('📱 Please enter a valid phone number');

  const groupId = state.room?.groupId;
  if (!groupId) return toast('⚠️ No active squad linked to this match.');

  const btn = document.getElementById('btn-submit-add-member');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding Teammate…'; }

  try {
    const res = await fetch(`/api/groups/${groupId}/add-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.session.token}` },
      body: JSON.stringify({
        name,
        phone: rawPhone,
        role
      })
    });
    const data = await res.json();
    if (!data.success) {
      toast('❌ ' + (data.error || 'Failed to add teammate'));
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Add to Squad'; }
      return;
    }

    closeModal('group-add-member-modal');
    toast(`🚀 Added ${name} directly to ${state.room?.groupName || 'Squad'}!`);

    // Reset input fields
    const nameInput = document.getElementById('group-add-member-name');
    const phoneInput = document.getElementById('group-add-member-phone');
    const searchInput = document.getElementById('group-add-search-input');
    const resEl = document.getElementById('group-add-search-results');
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    if (searchInput) searchInput.value = '';
    if (resEl) resEl.style.display = 'none';

    // Sync squad with room
    socket.emit('room:setGroup', { groupId });
    setTimeout(renderGroupRosterList, 150);
  } catch (err) {
    console.error('Error adding group member:', err);
    toast('❌ Network error while adding teammate.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Add to Squad'; }
  }
}
window.submitAddGroupMember = submitAddGroupMember;

async function onSearchPlayersForSquad(query, target) {
  const trimmed = (query || '').trim().toLowerCase();
  const resEl = document.getElementById(target === 'modal' ? 'group-add-search-results' : 'roster-quick-search-results');
  if (!resEl) return;

  if (!trimmed || trimmed.length < 1) {
    resEl.style.display = 'none';
    resEl.innerHTML = '';
    return;
  }

  // Ensure playersCache is populated from /api/players
  if (!Array.isArray(playersCache) || playersCache.length === 0) {
    try {
      const res = await fetch('/api/players');
      const data = await res.json();
      playersCache = data.players || [];
    } catch (e) {
      console.warn('Could not fetch players for search:', e);
    }
  }

  const matches = (playersCache || []).filter(p => {
    const pName = (p.name || '').toLowerCase();
    const pPhone = String(p.phone || '').replace(/\D/g, '');
    const pMasked = String(p.phoneMasked || '').toLowerCase();
    return pName.includes(trimmed) || pPhone.includes(trimmed) || pMasked.includes(trimmed);
  }).slice(0, 8);

  if (matches.length === 0) {
    resEl.innerHTML = `<div style="padding:0.6rem 0.8rem;font-size:0.78rem;color:var(--text-3);text-align:center">No registered players match "${escHtml(query)}". Type details below to register & add!</div>`;
    resEl.style.display = 'block';
    return;
  }

  resEl.innerHTML = matches.map(p => {
    const rawPhone = p.phone || '';
    const masked = p.phoneMasked || p.phone || '';
    const avatarHtml = getAvatarHtml(p.avatar, p.name, p.color, 28);
    const avatarBg = getAvatarBg(p.avatar, p.color);
    return `
      <div class="player-suggest-item" onclick="selectPlayerForSquad('${escHtml(p.name)}', '${escHtml(rawPhone)}', '${escHtml(p.role || 'All-Rounder')}', '${target}')">
        <div class="player-suggest-left">
          <div class="player-suggest-avatar" style="background:${avatarBg}">
            ${avatarHtml}
          </div>
          <div>
            <div class="player-suggest-name">${escHtml(p.name)}</div>
            <div class="player-suggest-role">${escHtml(p.role || 'All-Rounder')} · ${escHtml(masked)}</div>
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-xs" style="color:var(--primary);font-size:0.75rem;padding:0.2rem 0.5rem">Select ➕</button>
      </div>
    `;
  }).join('');
  resEl.style.display = 'block';
}
window.onSearchPlayersForSquad = onSearchPlayersForSquad;

function selectPlayerForSquad(name, phone, role, target) {
  if (target === 'modal') {
    const nameInput = document.getElementById('group-add-member-name');
    const phoneInput = document.getElementById('group-add-member-phone');
    const roleInput = document.getElementById('group-add-member-role');
    const searchInput = document.getElementById('group-add-search-input');
    const resEl = document.getElementById('group-add-search-results');

    if (nameInput) nameInput.value = name;
    if (phoneInput && phone) phoneInput.value = phone;
    if (roleInput && role) roleInput.value = role;
    if (searchInput) searchInput.value = '';
    if (resEl) resEl.style.display = 'none';
  } else {
    const nameInput = document.getElementById('roster-quick-name');
    const phoneInput = document.getElementById('roster-quick-phone');
    const roleInput = document.getElementById('roster-quick-role');
    const searchInput = document.getElementById('roster-quick-search');
    const resEl = document.getElementById('roster-quick-search-results');

    if (nameInput) nameInput.value = name;
    if (phoneInput && phone) phoneInput.value = phone;
    if (roleInput && role) roleInput.value = role;
    if (searchInput) searchInput.value = '';
    if (resEl) resEl.style.display = 'none';
  }
}
window.selectPlayerForSquad = selectPlayerForSquad;

async function openGroupRosterModal() {
  const modal = document.getElementById('group-roster-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderGroupRosterList();

  const groupId = state.room?.groupId;
  if (groupId) {
    try {
      const res = await fetch(`/api/groups/${groupId}?token=${encodeURIComponent(state.session?.token || '')}`);
      const data = await res.json();
      if (data.group) {
        if (!state.room) state.room = {};
        state.room.group = data.group;
        renderGroupRosterList();
      }
    } catch (e) {
      console.warn('Could not refresh group in modal:', e);
    }
  }
}
window.openGroupRosterModal = openGroupRosterModal;

function renderGroupRosterList() {
  const listEl = document.getElementById('group-roster-members-list');
  const titleEl = document.getElementById('group-roster-modal-title');
  if (!listEl) return;

  const room = state.room;
  const group = room?.group;
  const gName = group?.name || room?.groupName || 'Squad';
  if (titleEl) titleEl.textContent = `👥 ${gName} Roster`;

  let members = group?.members;
  if (!Array.isArray(members) || members.length === 0) {
    members = Object.values(room?.planning?.members || {});
  }

  if (members.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="padding:1rem">No teammates added yet. Add players below!</div>`;
    return;
  }

  const hostUser = isHost();
  listEl.innerHTML = members.map(m => {
    const isCaptain = m.role === 'captain' || (group?.hostPhone && phonesMatch(m.phone, group.hostPhone));
    const masked = m.phone ? `+${String(m.phone).slice(0, 2)} ••••• ••${String(m.phone).slice(-3)}` : '';
    const avatarHtml = getAvatarHtml(m.avatar, m.name, m.color, 32);
    const avatarBg = getAvatarBg(m.avatar, m.color);

    return `
      <div class="roster-member-item" style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius-sm)">
        <div style="display:flex;align-items:center;gap:0.6rem">
          <div style="width:32px;height:32px;border-radius:50%;background:${avatarBg};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.85rem;color:#000;overflow:hidden;flex-shrink:0">
            ${avatarHtml}
          </div>
          <div>
            <div style="font-weight:700;font-size:0.9rem;color:var(--text-1)">
              ${escHtml(m.name)} ${isCaptain ? '<span class="captain-badge" style="font-size:0.7rem;background:rgba(255,215,64,0.2);color:#ffd54f;padding:0.1rem 0.4rem;border-radius:4px;margin-left:0.3rem">👑 CAPTAIN</span>' : ''}
            </div>
            <div style="font-size:0.75rem;color:var(--text-3)">${escHtml(m.role || 'Player')} · ${masked}</div>
          </div>
        </div>
        ${hostUser && !isCaptain ? `
          <button class="btn btn-ghost btn-xs btn-remove-member" onclick="removeGroupMember('${escHtml(m.phone)}', '${escHtml(m.name)}')" title="Remove from squad" style="color:var(--danger);padding:0.3rem 0.6rem;font-size:0.8rem">
            🗑️ Remove
          </button>
        ` : ''}
      </div>
    `;
  }).join('');
}
window.renderGroupRosterList = renderGroupRosterList;

async function removeGroupMember(phone, name) {
  const groupId = state.room?.groupId;
  if (!groupId) return;

  if (!confirm(`Are you sure you want to remove "${name}" from this squad?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/groups/${groupId}/remove-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.session.token}` },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (!data.success) {
      toast('❌ ' + (data.error || 'Failed to remove member'));
      return;
    }

    toast(`🗑️ Removed ${name} from squad.`);
    // Sync squad with room
    socket.emit('room:setGroup', { groupId });
    setTimeout(renderGroupRosterList, 150);
  } catch (err) {
    console.error('Error removing group member:', err);
    toast('❌ Network error while removing member.');
  }
}
window.removeGroupMember = removeGroupMember;

async function submitQuickRosterAdd() {
  const name = document.getElementById('roster-quick-name')?.value?.trim();
  const rawPhone = document.getElementById('roster-quick-phone')?.value?.trim();
  const role = document.getElementById('roster-quick-role')?.value || 'All-Rounder';

  if (!name) return toast('👤 Please enter player name');
  if (!rawPhone || rawPhone.length < 8) return toast('📱 Please enter a valid phone number');

  const groupId = state.room?.groupId;
  if (!groupId) return toast('⚠️ No active squad linked to this match.');

  try {
    const res = await fetch(`/api/groups/${groupId}/add-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.session.token}` },
      body: JSON.stringify({ name, phone: rawPhone, role })
    });
    const data = await res.json();
    if (!data.success) {
      toast('❌ ' + (data.error || 'Failed to add teammate'));
      return;
    }

    document.getElementById('roster-quick-name').value = '';
    document.getElementById('roster-quick-phone').value = '';
    toast(`🚀 Added ${name} directly to squad!`);

    // Sync squad with room
    socket.emit('room:setGroup', { groupId });
    setTimeout(renderGroupRosterList, 150);
  } catch (err) {
    console.error('Error adding quick roster member:', err);
    toast('❌ Network error while adding teammate.');
  }
}
window.submitQuickRosterAdd = submitQuickRosterAdd;

async function openGroupSelectorModal() {
  await loadUserGroups();
  const modal = document.getElementById('group-selector-modal');
  const listEl = document.getElementById('group-selector-list');
  if (!modal || !listEl) return;

  modal.style.display = 'flex';

  if (!state.myGroups || state.myGroups.length === 0) {
    listEl.innerHTML = `<div class="empty-state" style="padding:1.5rem">You haven't created or joined any squads yet.</div>`;
    return;
  }

  const currentId = state.room?.groupId;
  listEl.innerHTML = state.myGroups.map(g => {
    const isSelected = g.id === currentId;
    const memCount = Array.isArray(g.members) ? g.members.length : 0;
    return `
      <div class="group-select-item ${isSelected ? 'selected' : ''}" onclick="selectRoomGroup('${escHtml(g.id)}')">
        <div>
          <div class="group-select-name">🏏 ${escHtml(g.name)} ${isSelected ? '✅' : ''}</div>
          <div class="group-select-sub">${memCount} members · Code: <span class="group-code-badge">${escHtml(g.code)}</span></div>
        </div>
        <button class="btn btn-primary btn-xs">${isSelected ? 'Active' : 'Select'}</button>
      </div>
    `;
  }).join('');
}
window.openGroupSelectorModal = openGroupSelectorModal;

function selectRoomGroup(groupId) {
  if (!groupId) return;
  closeModal('group-selector-modal');
  socket.emit('room:setGroup', { groupId }, (res) => {
    if (res?.success) {
      toast(`🏆 Match linked to squad: ${res.room?.groupName || 'Squad'}`);
    }
  });
}
window.selectRoomGroup = selectRoomGroup;

function unlinkRoomGroup() {
  closeModal('group-selector-modal');
  socket.emit('room:setGroup', { groupId: null }, () => {
    toast('ℹ️ Match unlinked from private squad. Open to all players.');
  });
}
window.unlinkRoomGroup = unlinkRoomGroup;

function onGroupQuickSelectChange(groupId) {
  if (!groupId) return;
  selectRoomGroup(groupId);
}
window.onGroupQuickSelectChange = onGroupQuickSelectChange;

// Keyboard & Backdrop Listeners for Group Modals
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('group-create-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('group-create-desc')?.focus();
  });
  document.getElementById('group-create-desc')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitCreateGroup();
  });
  document.getElementById('group-join-code-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitJoinGroup();
  });
  document.getElementById('group-add-member-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('group-add-member-phone')?.focus();
  });
  document.getElementById('group-add-member-phone')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAddGroupMember();
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
      }
    });
  });
});

function formatMatchSchedule(dateStr, timeStr) {
  if (!dateStr && !timeStr) return null;
  let formatted = '';
  if (dateStr) {
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        formatted += '📅 ' + d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      } else {
        formatted += '📅 ' + dateStr;
      }
    } catch (e) {
      formatted += '📅 ' + dateStr;
    }
  }
  if (timeStr) {
    try {
      const [h, m] = timeStr.split(':');
      const hour = parseInt(h);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      formatted += (formatted ? ' · ' : '') + `⏰ ${hour12}:${m} ${ampm}`;
    } catch (e) {
      formatted += (formatted ? ' · ' : '') + `⏰ ${timeStr}`;
    }
  }
  return formatted;
}

function renderPlanningSchedule() {
  const match = state.room?.match;
  if (!match) return;

  const dateInput = document.getElementById('planning-date-input');
  const timeInput = document.getElementById('planning-time-input');
  const displayEl = document.getElementById('planning-date-display');
  const formEl = document.getElementById('planning-date-form');

  if (dateInput && match.date && dateInput !== document.activeElement) dateInput.value = match.date;
  if (timeInput && match.time && timeInput !== document.activeElement) timeInput.value = match.time;

  const formatted = formatMatchSchedule(match.date, match.time);
  if (displayEl) {
    if (formatted) {
      displayEl.style.display = 'block';
      displayEl.innerHTML = `<strong>Match Scheduled:</strong><br>${escHtml(formatted)}`;
    } else {
      displayEl.style.display = 'none';
    }
  }

  // Non-hosts see only display if set
  const host = isHost();
  if (formEl) {
    formEl.style.display = host ? 'block' : 'none';
  }
  if (!host && !formatted && displayEl) {
    displayEl.style.display = 'block';
    displayEl.innerHTML = `<span style="color:var(--text-3);font-style:italic">Date not decided yet</span>`;
  }
}

function renderRsvpStats() {
  const members = Object.values(state.room?.planning?.members || {});
  const coming = members.filter(m => m.vote === 'coming').length;
  const maybe = members.filter(m => m.vote === 'maybe').length;
  const notComing = members.filter(m => m.vote === 'not_coming').length;
  const noVote = members.filter(m => m.vote === null).length;
  const onlineCount = members.filter(m => m.isOnline).length;

  document.getElementById('stat-coming').textContent = coming;
  document.getElementById('stat-maybe').textContent = maybe;
  document.getElementById('stat-not-coming').textContent = notComing;
  document.getElementById('stat-no-vote').textContent = noVote;

  const badgeEl = document.getElementById('planning-total-badge');
  if (badgeEl) {
    badgeEl.innerHTML = `${members.length} members · <span style="color:var(--success);font-weight:700">🟢 ${onlineCount} Live Now</span>`;
  }
}

function renderRsvpGrid() {
  const members = Object.values(state.room?.planning?.members || {});
  const myPhone = state.session?.user?.phone;
  const grid = document.getElementById('rsvp-grid');
  const host = isHost();

  if (members.length === 0) {
    grid.innerHTML = `<div class="empty-state-large" style="grid-column:1/-1"><div class="empty-icon">👥</div><p>No one has joined yet. Share the code!</p></div>`;
    return;
  }

  // Sort: online users first, then by vote
  const order = { coming: 0, maybe: 1, null: 2, not_coming: 3 };
  const sorted = [...members].sort((a, b) => {
    if (a.isOnline !== b.isOnline) return b.isOnline ? 1 : -1;
    return (order[a.vote] ?? 2) - (order[b.vote] ?? 2);
  });

  const voteLabels = {
    coming: { emoji: '✅', text: 'Coming', cls: 'coming' },
    maybe: { emoji: '🤔', text: 'Maybe', cls: 'maybe' },
    not_coming: { emoji: '❌', text: "Can't Come", cls: 'not_coming' },
    null: { emoji: '⏳', text: 'Pending', cls: 'null' }
  };

  grid.innerHTML = sorted.map(m => {
    const isMe = m.phone === myPhone;
    const vl = voteLabels[m.vote] || voteLabels.null;
    const isOnline = m.isOnline;

    const avatarHtml = getAvatarHtml(m.avatar, m.name, m.color, 44);
    const avatarBg = getAvatarBg(m.avatar, m.color);

    return `
      <div class="rsvp-card vote-${m.vote}${isMe ? ' my-card' : ''}">
        <div class="rsvp-card-top">
          <div class="rsvp-avatar player-profile-link" onclick="openPlayerProfile('${escHtml(m.phone || m.name)}')" style="background:${avatarBg};cursor:pointer;overflow:hidden" title="View Profile">${avatarHtml}</div>
          <div class="rsvp-name-wrap player-profile-link" onclick="openPlayerProfile('${escHtml(m.phone || m.name)}')" style="cursor:pointer" title="View Profile">
            <div class="rsvp-name">
              ${escHtml(m.name)}${isMe ? ' <span style="color:var(--primary);font-size:0.7rem">(you)</span>' : ''}
            </div>
            <div class="rsvp-phone">
              <span class="presence-badge ${isOnline ? 'online' : 'offline'}">
                <span class="presence-dot ${isOnline ? 'online' : 'offline'}"></span>
                ${isOnline ? 'Live Now' : 'Offline'}
              </span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:0.35rem">
            ${m.isHost ? '<span class="host-chip">HOST</span>' : ''}
            ${!isMe ? `<button class="nudge-btn-mini" onclick="nudgeMember('${m.phone}', '${escHtml(m.name)}')">🔔 Ping</button>` : ''}
          </div>
        </div>
        <div class="rsvp-vote-badge ${vl.cls}">
          ${vl.emoji} ${vl.text}
        </div>
        ${m.comment ? `<div class="rsvp-comment">"${escHtml(m.comment)}"</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderMyVote() {
  const myPhone = state.session?.user?.phone;
  const me = state.room?.planning?.members?.[myPhone];
  if (!me) return;

  // Highlight the right vote button
  ['coming', 'maybe', 'not-coming'].forEach(v => {
    document.getElementById(`vote-${v}`)?.classList.remove('selected');
  });
  if (me.vote === 'coming') document.getElementById('vote-coming')?.classList.add('selected');
  if (me.vote === 'maybe') document.getElementById('vote-maybe')?.classList.add('selected');
  if (me.vote === 'not_coming') document.getElementById('vote-not-coming')?.classList.add('selected');

  // Load saved comment
  const commentInput = document.getElementById('vote-comment');
  if (commentInput && me.comment && commentInput !== document.activeElement) {
    commentInput.value = me.comment;
  }
}

function renderPlanningAnnouncements() {
  const anns = state.room?.match?.announcements || [];
  const el = document.getElementById('planning-announcements');
  if (anns.length === 0) {
    el.innerHTML = '<div class="empty-state">No announcements yet</div>';
    return;
  }
  el.innerHTML = anns.map(a => `
    <div class="announcement-item">
      <div class="ann-text">📢 ${escHtml(a.text)}</div>
      <div class="ann-meta">${escHtml(a.author)} · ${fmtTime(a.timestamp)}</div>
    </div>
  `).join('');
}

function renderPlanningLocation() {
  const loc = state.room?.match?.location;
  const panel = document.getElementById('planning-location-panel');
  const displayEl = document.getElementById('planning-location-display');
  const formEl = document.getElementById('planning-location-form');
  const locTextInput = document.getElementById('planning-loc-text');
  const locMapInput = document.getElementById('planning-loc-map');
  if (!panel) return;

  panel.style.display = 'block';

  if (locTextInput && loc?.text && locTextInput !== document.activeElement) {
    locTextInput.value = loc.text;
  }
  if (locMapInput && loc?.mapUrl && locMapInput !== document.activeElement) {
    locMapInput.value = loc.mapUrl;
  }

  const host = isHost();
  if (formEl) {
    formEl.style.display = host ? 'block' : 'none';
  }

  if (displayEl) {
    if (loc?.text || loc?.mapUrl) {
      displayEl.style.display = 'block';
      let html = `<div style="font-weight:700;color:var(--text-1);font-size:0.95rem;margin-bottom:0.35rem">🏟️ ${escHtml(loc.text || 'Ground Venue')}</div>`;
      const validMap = sanitizeUrl(loc.mapUrl);
      if (validMap) {
        html += `<a href="${escHtml(validMap)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="display:inline-flex;align-items:center;gap:0.35rem;padding:0.35rem 0.75rem;font-size:0.82rem;color:var(--primary);text-decoration:none;border:1px solid var(--border)">📍 Open in Google Maps ↗</a>`;
      }
      displayEl.innerHTML = html;
    } else {
      if (!host) {
        displayEl.style.display = 'block';
        displayEl.innerHTML = `<span style="color:var(--text-3);font-style:italic">Venue location not decided yet</span>`;
      } else {
        displayEl.style.display = 'none';
      }
    }
  }
}

function renderPlanningChat() {
  const chat = state.room?.match?.chat || [];
  const container = document.getElementById('planning-chat-messages');
  if (!container) return;
  if (chat.length === 0) {
    container.innerHTML = '<div class="chat-welcome">Chat with the squad 🏏</div>';
    return;
  }
  container.innerHTML = chat.map(msg => `
    <div class="chat-msg">
      <div class="chat-msg-header">
        <span class="chat-author" style="color:${msg.color || '#fff'}">${escHtml(msg.author || 'Player')}</span>
        <span class="chat-time">${fmtTime(msg.timestamp || msg.time)}</span>
      </div>
      <div class="chat-text">${escHtml(msg.text || '')}</div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

// ── Vote Actions ─────────────────────────────
window.castVote = function (vote) {
  const comment = document.getElementById('vote-comment').value.trim();
  socket.emit('planning:vote', { vote, comment });
};

document.getElementById('btn-save-comment').addEventListener('click', () => {
  const comment = document.getElementById('vote-comment').value.trim();
  socket.emit('planning:vote', { comment });
  toast('💬 Comment saved!');
});

document.getElementById('vote-comment').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const comment = e.target.value.trim();
    socket.emit('planning:vote', { comment });
    toast('💬 Comment saved!');
  }
});

// ── Bulletproof Copy & Share Code (Mobile + Desktop + HTTP/HTTPS) ──
async function copyTextToClipboard(text, successMsg = '✅ Copied to clipboard!') {
  let success = false;

  // 1. Try modern clipboard API (requires secure context or localhost)
  if (navigator.clipboard && (window.isSecureContext || location.hostname === 'localhost')) {
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch (err) {
      success = false;
    }
  }

  // 2. Fallback for HTTP / Mobile Safari / Mobile Chrome
  if (!success) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      textarea.style.top = (window.pageYOffset || document.documentElement.scrollTop) + 'px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, 99999); // Mobile iOS Safari selection fix
      success = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (err) {
      console.warn('execCommand copy failed:', err);
      success = false;
    }
  }

  if (success) {
    toast(successMsg);
  } else {
    prompt('Copy to clipboard:', text);
  }
  return success;
}

function openShareModal() {
  const code = state.room?.code;
  if (!code) return toast('No room code available');
  const modal = document.getElementById('share-modal');
  if (modal) {
    document.getElementById('share-modal-code').textContent = code;
    modal.style.display = 'flex';
  } else {
    copyTextToClipboard(code, `✅ Room code ${code} copied!`);
  }
}

function shareViaWhatsApp() {
  const code = state.room?.code;
  if (!code) return;
  const matchName = state.room?.matchName || 'Cricket Match';
  const url = window.location.href;
  const text = `🏏 Join our cricket match "${matchName}" on CricketHub!\n\n📲 Room Code: *${code}*\n🔗 Link: ${url}`;
  const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

// ── Share Code Handlers ───────────────────────
document.getElementById('btn-copy-planning-code')?.addEventListener('click', openShareModal);
document.getElementById('planning-room-code')?.addEventListener('click', openShareModal);

document.getElementById('btn-share-whatsapp')?.addEventListener('click', () => {
  shareViaWhatsApp();
  document.getElementById('share-modal').style.display = 'none';
});

document.getElementById('btn-share-copy-code')?.addEventListener('click', () => {
  const code = state.room?.code;
  if (code) copyTextToClipboard(code, `✅ Room code ${code} copied!`);
  document.getElementById('share-modal').style.display = 'none';
});

document.getElementById('btn-share-copy-link')?.addEventListener('click', () => {
  copyTextToClipboard(window.location.href, '✅ Match link copied!');
  document.getElementById('share-modal').style.display = 'none';
});

document.getElementById('btn-close-share-modal')?.addEventListener('click', () => {
  document.getElementById('share-modal').style.display = 'none';
});

document.getElementById('share-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'share-modal') {
    document.getElementById('share-modal').style.display = 'none';
  }
});

// ── Proceed to Match Setup ───────────────────
document.getElementById('btn-proceed-setup').addEventListener('click', () => {
  enterLobby();
});

// ── Save Planning Date & Time ────────────────
document.getElementById('btn-save-planning-date')?.addEventListener('click', () => {
  const date = document.getElementById('planning-date-input')?.value || null;
  const time = document.getElementById('planning-time-input')?.value || null;
  socket.emit('planning:date', { date, time });
  toast('📅 Match schedule saved!');
});

// ── Save Planning Venue & Google Maps ─────────
document.getElementById('btn-save-planning-loc')?.addEventListener('click', () => {
  const text = document.getElementById('planning-loc-text')?.value.trim() || '';
  let mapUrl = document.getElementById('planning-loc-map')?.value.trim() || '';
  if (!mapUrl && text) {
    mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
    const mapInput = document.getElementById('planning-loc-map');
    if (mapInput) mapInput.value = mapUrl;
  }
  socket.emit('match:setup', { location: { text, mapUrl } });
  toast('📍 Venue location saved!');
});

document.getElementById('btn-search-gmaps')?.addEventListener('click', () => {
  const text = document.getElementById('planning-loc-text')?.value.trim() || '';
  const searchUrl = text
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`
    : 'https://maps.google.com';
  window.open(searchUrl, '_blank', 'noopener,noreferrer');
});

// ── Host Squad Ping / Nudge ──────────────────
document.getElementById('btn-nudge-all')?.addEventListener('click', () => {
  const customMsg = document.getElementById('nudge-custom-msg')?.value.trim();
  socket.emit('planning:nudge', { message: customMsg || undefined });
  toast('🔔 Ping alert sent to all squad members!');
  const input = document.getElementById('nudge-custom-msg');
  if (input) input.value = '';
});

window.nudgeMember = function (targetPhone, name) {
  socket.emit('planning:nudge', { targetPhone, message: `Hey ${name}, are you playing? Please confirm your RSVP!` });
  toast(`🔔 Pinged ${name}!`);
};

// ── Audio Ping Chime (Web Audio API) ──────────
function playPingChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now); // E5
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(987.77, now + 0.12); // B5
    gain2.gain.setValueAtTime(0.25, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.5);
  } catch (e) { /* ignore blocked audio */ }
}

// ── Alert Modal Handlers ─────────────────────
document.getElementById('btn-alert-rsvp-coming')?.addEventListener('click', () => {
  const modal = document.getElementById('popup-alert-modal');
  const alertData = modal._alertData;
  modal.style.display = 'none';

  if (alertData?.roomCode) {
    joinRoomDirect(alertData.roomCode, 'coming');
  } else if (state.room?.code) {
    socket.emit('planning:vote', { vote: 'coming' });
    toast('✅ Confirmed: Coming!');
    showPlanningScreen();
  }
});

document.getElementById('btn-alert-view-match')?.addEventListener('click', () => {
  const modal = document.getElementById('popup-alert-modal');
  const alertData = modal._alertData;
  modal.style.display = 'none';

  if (alertData?.roomCode) {
    joinRoomDirect(alertData.roomCode);
  } else {
    showPlanningScreen();
  }
});

document.getElementById('btn-dismiss-alert')?.addEventListener('click', () => {
  document.getElementById('popup-alert-modal').style.display = 'none';
});

document.getElementById('popup-alert-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'popup-alert-modal') {
    document.getElementById('popup-alert-modal').style.display = 'none';
  }
});

// ── Planning Announcements ───────────────────
document.getElementById('btn-planning-announce').addEventListener('click', () => {
  const input = document.getElementById('planning-announce-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('announcement:add', { text });
  input.value = '';
  toast('📢 Announcement posted!');
});
document.getElementById('planning-announce-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-planning-announce').click();
});

// ── Planning Chat ────────────────────────────
document.getElementById('btn-planning-chat').addEventListener('click', sendPlanningChat);
document.getElementById('planning-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendPlanningChat();
});

function sendPlanningChat() {
  const input = document.getElementById('planning-chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat:message', { text });
  input.value = '';
}

// ── Planning Chat receive ────────────────────
socket.on('chat:message', (msg) => {
  // Append to whichever chat container is active
  ['planning-chat-messages', 'chat-messages'].forEach(id => {
    const container = document.getElementById(id);
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-author" style="color:${msg.color}">${escHtml(msg.author)}</span>
        <span class="chat-time">${fmtTime(msg.timestamp || msg.time)}</span>
      </div>
      <div class="chat-text">${escHtml(msg.text)}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  });
});

// ══════════════════════════════════════════════
//  PLANNING SOCKET EVENTS
// ══════════════════════════════════════════════
socket.on('planning:update', (room) => {
  state.room = room;
  if (document.getElementById('screen-planning').classList.contains('active')) {
    renderPlanningScreen();
  }
  // Also update announcements in lobby if visible
  renderAnnouncements();
});

// ── Popup Alert Push / Ping from Host ─────────
const seenAlertIds = new Set();

socket.on('popup:alert', (data) => {
  if (!data || !data.id) return;

  const alertIdStr = String(data.id);
  // 1. Strict deduplication: Do not show the same ping multiple times
  if (seenAlertIds.has(alertIdStr)) {
    return;
  }

  // 2. Discard stale alerts older than 90 seconds
  if (data.timestamp && (Date.now() - data.timestamp > 90 * 1000)) {
    return;
  }

  // 3. Do not show alert to the sender themselves
  const myPhone = state.session?.user?.phone ? String(state.session.user.phone).replace(/\D/g, '') : null;
  const senderPhone = data.senderPhone ? String(data.senderPhone).replace(/\D/g, '') : null;
  if (myPhone && senderPhone) {
    if (myPhone === senderPhone || (myPhone.length >= 6 && senderPhone.endsWith(myPhone.slice(-10))) || (senderPhone.length >= 6 && myPhone.endsWith(senderPhone.slice(-10)))) {
      return; // Ignore alerts sent by myself
    }
  }

  // 4. If the user is ALREADY active inside this specific match room, do not interrupt them with a modal (just play chime and subtle toast) unless it is a direct ping
  const isCurrentlyInThisRoom = state.room && state.room.code && data.roomCode && (state.room.code.toUpperCase() === data.roomCode.toUpperCase());
  if (isCurrentlyInThisRoom && !data.isDirect) {
    seenAlertIds.add(alertIdStr);
    playPingChime();
    toast(`⚡ ${data.author || 'Organizer'}: ${data.message || 'Squad Ping'}`);
    return;
  }

  seenAlertIds.add(alertIdStr);

  // 5. Play chime audio
  playPingChime();

  // 6. Hardware vibration
  if (navigator.vibrate) {
    try { navigator.vibrate([200, 100, 200, 100, 200]); } catch (e) { }
  }

  // 7. Show system notification only if app is currently in background/hidden
  if (document.visibilityState === 'hidden') {
    triggerPushNotification(data);
  }

  // 8. Foreground Modal
  const modal = document.getElementById('popup-alert-modal');
  const codeBadge = document.getElementById('popup-alert-code-badge');
  const title = document.getElementById('popup-alert-title');
  const matchNameEl = document.getElementById('popup-alert-match-name');
  const scheduleEl = document.getElementById('popup-alert-schedule');
  const msgEl = document.getElementById('popup-alert-msg');
  const authorEl = document.getElementById('popup-alert-author');
  const timeEl = document.getElementById('popup-alert-time');

  if (codeBadge) codeBadge.textContent = data.roomCode || 'CRK-MATCH';
  if (title) title.textContent = data.isDirect ? '🔔 Direct Squad Ping!' : '⚡ Match Invitation Alert!';
  if (matchNameEl) matchNameEl.textContent = data.matchName || (state.room?.matchName || 'Upcoming Match');

  const sched = formatMatchSchedule(data.date, data.time);
  if (scheduleEl) {
    scheduleEl.style.display = sched ? 'block' : 'none';
    scheduleEl.textContent = sched || '';
  }

  if (msgEl) msgEl.textContent = data.message || 'The match organizer is asking you to confirm availability!';
  if (authorEl) authorEl.textContent = data.author || 'Organizer';
  if (timeEl) timeEl.textContent = fmtTime(data.timestamp || Date.now());

  modal._alertData = data;
  modal.style.display = 'flex';
});

// ── Alert Modal Handlers ─────────────────────
document.getElementById('btn-alert-rsvp-coming')?.addEventListener('click', () => {
  const modal = document.getElementById('popup-alert-modal');
  const alertData = modal._alertData;
  modal.style.display = 'none';
  if (alertData?.id) seenAlertIds.add(String(alertData.id));

  if (alertData?.roomCode) {
    joinRoomDirect(alertData.roomCode, 'coming');
  } else if (state.room?.code) {
    socket.emit('planning:vote', { vote: 'coming' });
    toast('✅ Confirmed: Coming!');
    showPlanningScreen();
  }
});

document.getElementById('btn-alert-view-match')?.addEventListener('click', () => {
  const modal = document.getElementById('popup-alert-modal');
  const alertData = modal._alertData;
  modal.style.display = 'none';
  if (alertData?.id) seenAlertIds.add(String(alertData.id));

  if (alertData?.roomCode) {
    joinRoomDirect(alertData.roomCode);
  } else {
    showPlanningScreen();
  }
});

document.getElementById('btn-dismiss-alert')?.addEventListener('click', () => {
  const modal = document.getElementById('popup-alert-modal');
  if (modal._alertData?.id) seenAlertIds.add(String(modal._alertData.id));
  modal.style.display = 'none';
});

document.getElementById('popup-alert-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'popup-alert-modal') {
    const modal = document.getElementById('popup-alert-modal');
    if (modal._alertData?.id) seenAlertIds.add(String(modal._alertData.id));
    modal.style.display = 'none';
  }
});

// ══════════════════════════════════════════════
//  SCREEN 4 — MATCH LOBBY
// ══════════════════════════════════════════════
function enterLobby() {
  showScreen('screen-lobby');
  document.getElementById('room-code-display').textContent = state.room?.code || '';
  document.getElementById('banner-match-name').textContent = state.room?.matchName || '';

  // User badge
  updateAllUserBadges();

  loadSetupFromState();
  applyHostGating();   // ← disable controls for non-hosts
  renderAll();

  // If match is already in toss phase (page refresh / late arrival), re-open for host
  if (state.room?.match?.status === 'toss' && isHost()) {
    setTimeout(() => showTossModal(), 400);
  }

  // Non-hosts: default to scorecard tab if match is live
  if (!isHost()) {
    const status = state.room?.match?.status;
    if (status === 'innings1' || status === 'innings2') {
      document.querySelector('.tab[data-tab="scorecard"]')?.click();
    } else if (status === 'completed') {
      document.querySelector('.tab[data-tab="summary"]')?.click();
    }
  }
}

// ── Host gating: disable edit controls for non-hosts ──
function applyHostGating() {
  const host = isHost();

  // Setup tab: inputs, selects, buttons
  const setupTab = document.getElementById('tab-setup');
  if (setupTab) {
    setupTab.querySelectorAll('input, select').forEach(el => {
      el.disabled = !host;
      if (!host) el.style.opacity = '0.6';
    });
    // Hide add-player rows, save buttons, toss button, reset button for non-host
    setupTab.querySelectorAll('.add-player-row').forEach(el => el.style.display = host ? 'flex' : 'none');
    const saveSetup = document.getElementById('btn-save-setup');
    if (saveSetup) saveSetup.style.display = host ? 'inline-flex' : 'none';
    const saveLoc = document.getElementById('btn-save-location');
    if (saveLoc) saveLoc.style.display = host ? 'inline-flex' : 'none';
    const resetBtn = document.getElementById('btn-reset-match');
    if (resetBtn) resetBtn.style.display = host ? 'block' : 'none';
    // Also hide tag remove buttons for non-host
    if (!host) {
      setupTab.querySelectorAll('.tag-remove').forEach(el => el.style.display = 'none');
    }
  }
}

document.getElementById('btn-back-planning').addEventListener('click', () => {
  showScreen('screen-planning');
  renderPlanningScreen();
});

// ── Tabs ────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'scorecard') renderScorecard();
    if (tab.dataset.tab === 'scoring') renderScoringPanel();
    if (tab.dataset.tab === 'summary') renderSummary();
  });
});

function renderAll() {
  renderPlayers();
  renderAnnouncements();
  renderBanner();
  renderTeamTags('team1');
  renderTeamTags('team2');
  populatePlayerSelects();
  syncOversSetting();
  renderScorecard();
  renderScoringPanel();
  renderSummary();
}

// ── Players Panel ────────────────────────────
function renderPlayers() {
  const { room } = state;
  if (!room) return;
  const members = Object.values(room.planning?.members || {});

  const list = document.getElementById('players-list');
  const countBadge = document.getElementById('player-count');
  if (!list) return;
  countBadge.textContent = members.length;

  list.innerHTML = members.map(m => {
    const avatarHtml = getAvatarHtml(m.avatar, m.name, m.color, 36);
    const avatarBg = getAvatarBg(m.avatar, m.color);

    return `
      <div class="player-item player-profile-link" onclick="openPlayerProfile('${escHtml(m.phone || m.name)}')" style="cursor:pointer" title="View Profile">
        <div class="player-avatar" style="background:${avatarBg};overflow:hidden">${avatarHtml}</div>
        <span class="player-name">${escHtml(m.name)}</span>
        ${m.isHost ? '<span class="player-host">HOST</span>' : ''}
        <span class="player-status">${m.vote === 'coming' ? '✅' : m.vote === 'maybe' ? '🤔' : m.vote === 'not_coming' ? '❌' : '⏳'
      }</span>
      </div>
    `;
  }).join('');
}

// ── Announcements ────────────────────────────
function renderAnnouncements() {
  const anns = state.room?.match?.announcements || [];
  const list = document.getElementById('announcements-list');
  if (!list) return;
  if (anns.length === 0) {
    list.innerHTML = '<div class="empty-state">No announcements yet</div>';
    return;
  }
  list.innerHTML = anns.map(a => `
    <div class="announcement-item">
      <div class="ann-text">📢 ${escHtml(a.text)}</div>
      <div class="ann-meta">${escHtml(a.author)} · ${fmtTime(a.timestamp)}</div>
    </div>
  `).join('');
}

document.getElementById('btn-announce').addEventListener('click', () => {
  const input = document.getElementById('announce-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('announcement:add', { text });
  input.value = '';
});
document.getElementById('announce-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-announce').click();
});

// ── Banner ───────────────────────────────────
function renderBanner() {
  const { room } = state;
  if (!room) return;
  const match = room.match;

  const statusEl = document.getElementById('banner-status');
  if (!statusEl) return;
  const statusMap = {
    planning: { text: 'Planning', cls: '' },
    toss: { text: 'Toss', cls: 'toss' },
    innings1: { text: '🔴 LIVE — 1st Inn', cls: 'live' },
    innings2: { text: '🔴 LIVE — 2nd Inn', cls: 'live' },
    completed: { text: 'Completed', cls: 'completed' }
  };
  const s = statusMap[match.status] || { text: match.status, cls: '' };
  statusEl.textContent = s.text;
  statusEl.className = 'status-pill ' + s.cls;

  // Schedule display in banner
  const schedEl = document.getElementById('banner-schedule');
  if (schedEl) {
    const formatted = formatMatchSchedule(match.date, match.time);
    if (formatted) {
      schedEl.style.display = 'inline-block';
      schedEl.textContent = formatted;
    } else {
      schedEl.style.display = 'none';
    }
  }

  // Inject a clickable toss button for host when status=toss
  const tossOpenBtn = document.getElementById('banner-open-toss');
  if (match.status === 'toss' && isHost()) {
    if (!tossOpenBtn) {
      const btn = document.createElement('button');
      btn.id = 'banner-open-toss';
      btn.className = 'btn btn-primary btn-sm';
      btn.style.cssText = 'padding:0.3rem 0.85rem;font-size:0.8rem;animation:pulse-warn 1.6s ease infinite';
      btn.innerHTML = '🪙 Open Coin Toss';
      btn.onclick = () => showTossModal();
      statusEl.insertAdjacentElement('afterend', btn);
    }
  } else if (tossOpenBtn) {
    tossOpenBtn.remove();
  }

  const locEl = document.getElementById('banner-location');
  if (locEl && (match.location?.text || match.location?.mapUrl)) {
    const t = match.location.text || 'View on Maps';
    const validUrl = sanitizeUrl(match.location.mapUrl);
    locEl.innerHTML = validUrl ? `📍 <a href="${escHtml(validUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(t)}</a>` : `📍 ${escHtml(t)}`;
  }
}

// ── Copy Code ────────────────────────────────
document.getElementById('btn-copy-code')?.addEventListener('click', openShareModal);
document.getElementById('room-code-display')?.addEventListener('click', openShareModal);

// ══════════════════════════════════════════════
//  SETUP TAB
// ══════════════════════════════════════════════
let allRegisteredPlayers = [];

async function fetchRegisteredPlayers() {
  try {
    const res = await fetch('/api/players');
    const data = await res.json();
    if (data.players) {
      allRegisteredPlayers = data.players;
    }
  } catch (e) {
    console.error('Failed to fetch registered players:', e);
  }
}

let pickerPlayersData = [];

async function populatePlayerSelects() {
  const roomMembers = Object.values(state.room?.planning?.members || {});
  const allMap = new Map(); // name.toLowerCase() -> player object

  // Add all participants who joined this room
  for (const m of roomMembers) {
    if (m && m.name) {
      const key = m.name.toLowerCase();
      const rsvp = m.vote === 'coming' ? '✅ Coming' : m.vote === 'maybe' ? '🤔 Maybe' : m.vote === 'not_coming' ? '❌ Cant Come' : '⏳ Pending';
      allMap.set(key, {
        name: m.name,
        info: `Room Participant (${rsvp})`,
        avatar: m.avatar || null,
        color: m.color || '#00e5ff',
        rsvpText: rsvp,
        vote: m.vote || 'pending',
        phone: m.phone || ''
      });
    }
  }

  // Ensure current user is included if in room
  if (state.session?.user?.name) {
    const uName = state.session.user.name;
    const key = uName.toLowerCase();
    if (!allMap.has(key)) {
      allMap.set(key, {
        name: uName,
        info: 'Host / Player',
        avatar: state.session.user.avatar || null,
        color: state.session.user.color || '#00e5ff',
        rsvpText: '✅ Room Member',
        vote: 'coming',
        phone: state.session.user.phone || ''
      });
    }
  }

  // Sort: Coming first, then Maybe, then Pending, then alphabetical
  const votePriority = { coming: 1, maybe: 2, pending: 3, not_coming: 4 };
  pickerPlayersData = Array.from(allMap.values()).sort((a, b) => {
    const pA = votePriority[a.vote] || 3;
    const pB = votePriority[b.vote] || 3;
    if (pA !== pB) return pA - pB;
    return a.name.localeCompare(b.name);
  });

  ['team1', 'team2'].forEach(team => {
    const searchInput = document.getElementById(`search-player-${team}`);
    const query = searchInput ? searchInput.value : '';
    renderPickerList(team, query);
  });
}

function renderPickerList(team, searchTerm = '') {
  const listEl = document.getElementById(`picker-list-${team}`);
  if (!listEl) return;

  const currentT1 = state.room?.match?.teams?.team1?.players || [];
  const currentT2 = state.room?.match?.teams?.team2?.players || [];
  const addedT1 = new Set(currentT1.map(n => extractPlayerName(n).toLowerCase()));
  const addedT2 = new Set(currentT2.map(n => extractPlayerName(n).toLowerCase()));

  const term = searchTerm.trim().toLowerCase();
  const rawTerm = searchTerm.trim();
  const filtered = pickerPlayersData.filter(p => !term || p.name.toLowerCase().includes(term));

  const exactMatchExists = pickerPlayersData.some(p => p.name.toLowerCase() === term);

  let html = '';

  const renderItem = (p) => {
    const key = p.name.toLowerCase();
    const inT1 = addedT1.has(key);
    const inT2 = addedT2.has(key);
    const isAdded = inT1 || inT2;
    const teamBadge = inT1
      ? `<span class="picker-badge in-t1">In Team 1</span>`
      : (inT2 ? `<span class="picker-badge in-t2">In Team 2</span>` : '');

    const avatarHtml = getAvatarHtml(p.avatar, p.name, p.color, 32);
    const avatarBg = getAvatarBg(p.avatar, p.color);
    const subText = `<span class="picker-sub">${p.rsvpText || 'Room Participant'}</span>`;

    const escapedName = escHtml(p.name).replace(/'/g, "\\'");
    const clickAttr = isAdded ? '' : `onclick="selectPickerPlayer('${team}', '${escapedName}')"`;

    return `
      <div class="picker-item ${isAdded ? 'disabled' : ''}" ${clickAttr}>
        <div class="picker-avatar" style="background:${avatarBg};overflow:hidden">
          ${avatarHtml}
        </div>
        <div class="picker-info">
          <div class="picker-name">${escHtml(p.name)}</div>
          ${subText}
        </div>
        ${teamBadge ? teamBadge : `<span class="picker-add-action">➕ Add</span>`}
      </div>
    `;
  };

  if (filtered.length > 0) {
    html += `<div class="picker-section-title">👥 Room Participants (${filtered.length})</div>`;
    for (const p of filtered) {
      html += renderItem(p);
    }
  } else if (pickerPlayersData.length === 0 && !rawTerm) {
    html += `
      <div style="padding:1.4rem;text-align:center;color:var(--text-3);font-size:0.85rem">
        👥 No room participants joined yet.<br><span style="font-size:0.78rem;color:var(--text-2);margin-top:4px;display:inline-block">Share room code or type a player name above to add.</span>
      </div>
    `;
  } else if (filtered.length === 0 && !rawTerm) {
    html += `
      <div style="padding:1.4rem;text-align:center;color:var(--text-3);font-size:0.85rem">
        🔍 No matching participants found
      </div>
    `;
  }

  // If user typed a search query that isn't already an exact match, allow quick-adding custom player
  if (rawTerm && !exactMatchExists) {
    const escapedRaw = escHtml(rawTerm).replace(/'/g, "\\'");
    html += `
      <div class="picker-section-title" style="margin-top:0.5rem">➕ Quick Add Player</div>
      <div class="picker-item" onclick="selectPickerPlayer('${team}', '${escapedRaw}')">
        <div class="picker-avatar" style="background:linear-gradient(135deg,var(--primary),var(--primary-dark,#00b0ff));color:#000;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem">
          +
        </div>
        <div class="picker-info">
          <div class="picker-name">Add "${escHtml(rawTerm)}"</div>
          <span class="picker-sub">Custom / Guest Player</span>
        </div>
        <span class="picker-add-action">➕ Add</span>
      </div>
    `;
  }

  listEl.innerHTML = html;
}

window.togglePlayerPicker = function (team) {
  const container = document.getElementById(`t${team === 'team1' ? '1' : '2'}-picker-container`);
  const menu = document.getElementById(`picker-menu-${team}`);
  const btn = document.getElementById(`btn-open-picker-${team}`);
  if (!menu || !btn) return;

  const isCurrentlyOpen = menu.style.display !== 'none';
  closeAllPlayerPickers();

  if (!isCurrentlyOpen) {
    menu.style.display = 'block';
    btn.classList.add('active');
    if (container) container.classList.add('is-open');
    const teamBox = btn.closest('.team-col');
    if (teamBox) teamBox.classList.add('has-open-picker');
    const searchInput = document.getElementById(`search-player-${team}`);
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    renderPickerList(team, '');
  }
};

window.closeAllPlayerPickers = function () {
  ['team1', 'team2'].forEach(t => {
    const num = t === 'team1' ? '1' : '2';
    const container = document.getElementById(`t${num}-picker-container`);
    const menu = document.getElementById(`picker-menu-${t}`);
    const btn = document.getElementById(`btn-open-picker-${t}`);
    if (menu) menu.style.display = 'none';
    if (btn) {
      btn.classList.remove('active');
      const teamBox = btn.closest('.team-col');
      if (teamBox) teamBox.classList.remove('has-open-picker');
    }
    if (container) container.classList.remove('is-open');
  });
};

window.filterPickerPlayers = function (team) {
  const searchInput = document.getElementById(`search-player-${team}`);
  const query = searchInput ? searchInput.value : '';
  renderPickerList(team, query);
};

window.selectPickerPlayer = function (team, playerName) {
  addPlayer(team, playerName);
  // Clear search query after adding and refresh list so dropdown stays cleanly interactive
  const searchInput = document.getElementById(`search-player-${team}`);
  if (searchInput) {
    searchInput.value = '';
    renderPickerList(team, '');
  }
};

function extractPlayerName(p) {
  if (!p) return '';
  if (typeof p === 'string') return p.trim();
  if (typeof p === 'object') return (p.name || p.id || '').trim();
  return String(p).trim();
}
window.extractPlayerName = extractPlayerName;

function loadSetupFromState() {
  if (!state.room || !state.room.match) return;
  const match = state.room.match;
  if (match.teams) {
    if (Array.isArray(match.teams.team1?.players)) {
      match.teams.team1.players = match.teams.team1.players.map(p => extractPlayerName(p)).filter(Boolean);
    }
    if (Array.isArray(match.teams.team2?.players)) {
      match.teams.team2.players = match.teams.team2.players.map(p => extractPlayerName(p)).filter(Boolean);
    }
  }
  const t1Name = document.getElementById('team1-name');
  const t2Name = document.getElementById('team2-name');
  if (t1Name) t1Name.value = match.teams?.team1?.name || 'Team 1';
  if (t2Name) t2Name.value = match.teams?.team2?.name || 'Team 2';
  syncOversSetting();
  renderTeamTags('team1');
  renderTeamTags('team2');
  populatePlayerSelects();
  updateTossButton();
}

const OVERS_FORMAT_LABELS = {
  '5': '⚡ 5 Overs (Quick Blitz)',
  '10': '🚀 10 Overs (T10)',
  '15': '🏏 15 Overs',
  '20': '🏆 20 Overs (T20 Standard)',
  '25': '🎯 25 Overs',
  '50': '🌍 50 Overs (ODI)'
};

// Sync the overs custom dropdown (and custom input) to match state
function syncOversSetting() {
  if (!state.room) return;
  const overs = state.room.match?.overs || 20;
  const sel = document.getElementById('setting-overs');
  const customWrap = document.getElementById('custom-overs-wrap');
  const customInput = document.getElementById('custom-overs-input');
  const labelEl = document.getElementById('selected-overs-label');

  const strOvers = String(overs);
  if (OVERS_FORMAT_LABELS[strOvers]) {
    if (sel) sel.value = strOvers;
    if (customWrap) customWrap.style.display = 'none';
    if (labelEl) labelEl.textContent = OVERS_FORMAT_LABELS[strOvers];
    updateOversOptionHighlight(strOvers);
  } else {
    if (sel) sel.value = 'custom';
    if (customWrap) customWrap.style.display = 'block';
    if (customInput) customInput.value = overs;
    if (labelEl) labelEl.textContent = `✏️ ${overs} Overs (Custom)`;
    updateOversOptionHighlight('custom');
  }
}

function updateOversOptionHighlight(val) {
  document.querySelectorAll('.overs-option-item').forEach(item => {
    const isMatch = item.getAttribute('data-value') === String(val);
    item.classList.toggle('selected', isMatch);
    const checkEl = item.querySelector('.overs-opt-check');
    if (checkEl) checkEl.textContent = isMatch ? '✓' : '';
  });
}

window.toggleOversPicker = function () {
  const container = document.getElementById('overs-picker-container');
  const menu = document.getElementById('overs-menu');
  const btn = document.getElementById('btn-open-overs-picker');
  const settingsCard = container?.closest('.setup-settings-card');
  if (!menu || !btn) return;

  const isOpen = menu.style.display !== 'none';
  closeAllPlayerPickers();

  if (!isOpen) {
    menu.style.display = 'block';
    btn.classList.add('active');
    if (container) container.classList.add('is-open');
    if (settingsCard) settingsCard.classList.add('has-open-picker');
  } else {
    closeOversPicker();
  }
};

window.closeOversPicker = function () {
  const container = document.getElementById('overs-picker-container');
  const menu = document.getElementById('overs-menu');
  const btn = document.getElementById('btn-open-overs-picker');
  const settingsCard = container?.closest('.setup-settings-card');
  if (menu) menu.style.display = 'none';
  if (btn) btn.classList.remove('active');
  if (container) container.classList.remove('is-open');
  if (settingsCard) settingsCard.classList.remove('has-open-picker');
};

window.selectOversOption = function (val, label) {
  const sel = document.getElementById('setting-overs');
  const labelEl = document.getElementById('selected-overs-label');
  const customWrap = document.getElementById('custom-overs-wrap');
  const customInput = document.getElementById('custom-overs-input');

  if (sel) sel.value = val;
  updateOversOptionHighlight(val);

  if (val === 'custom') {
    if (labelEl) labelEl.textContent = '✏️ Custom Overs...';
    if (customWrap) {
      customWrap.style.display = 'block';
      if (customInput) customInput.focus();
    }
  } else {
    if (labelEl) labelEl.textContent = label;
    if (customWrap) customWrap.style.display = 'none';
  }
  closeOversPicker();
};

window.applyQuickCustomOvers = function (num) {
  const sel = document.getElementById('setting-overs');
  const customWrap = document.getElementById('custom-overs-wrap');
  const customInput = document.getElementById('custom-overs-input');
  const labelEl = document.getElementById('selected-overs-label');

  if (sel) sel.value = 'custom';
  if (customInput) customInput.value = num;
  if (customWrap) customWrap.style.display = 'block';
  if (labelEl) labelEl.textContent = `✏️ ${num} Overs (Custom)`;
  updateOversOptionHighlight('custom');
  closeOversPicker();
};

window.applyMenuCustomOvers = function () {
  const input = document.getElementById('menu-custom-overs-input');
  const val = parseInt(input?.value);
  if (!val || val < 1 || val > 100) {
    return toast('⚠️ Please enter between 1 and 100 overs');
  }
  applyQuickCustomOvers(val);
  if (input) input.value = '';
};

// Global outside-click listener to close match setup dropdowns
document.addEventListener('click', (e) => {
  // Close Team 1 Player Picker if clicking outside its container
  if (!e.target.closest('#t1-picker-container')) {
    const menu1 = document.getElementById('picker-menu-team1');
    const btn1 = document.getElementById('btn-open-picker-team1');
    const container1 = document.getElementById('t1-picker-container');
    if (menu1 && menu1.style.display !== 'none') {
      menu1.style.display = 'none';
      if (btn1) btn1.classList.remove('active');
      if (container1) container1.classList.remove('is-open');
      const teamBox1 = btn1?.closest('.team-col');
      if (teamBox1) teamBox1.classList.remove('has-open-picker');
    }
  }

  // Close Team 2 Player Picker if clicking outside its container
  if (!e.target.closest('#t2-picker-container')) {
    const menu2 = document.getElementById('picker-menu-team2');
    const btn2 = document.getElementById('btn-open-picker-team2');
    const container2 = document.getElementById('t2-picker-container');
    if (menu2 && menu2.style.display !== 'none') {
      menu2.style.display = 'none';
      if (btn2) btn2.classList.remove('active');
      if (container2) container2.classList.remove('is-open');
      const teamBox2 = btn2?.closest('.team-col');
      if (teamBox2) teamBox2.classList.remove('has-open-picker');
    }
  }

  // Close Overs Picker if clicking outside its container
  if (!e.target.closest('#overs-picker-container')) {
    closeOversPicker();
  }
});

window.stepCustomOvers = function (delta) {
  const input = document.getElementById('custom-overs-input');
  if (!input) return;
  let val = parseInt(input.value) || 20;
  val = Math.max(1, Math.min(100, val + delta));
  input.value = val;
  handleCustomOversInput(val);
};

window.handleCustomOversInput = function (val) {
  const labelEl = document.getElementById('selected-overs-label');
  const num = parseInt(val);
  if (labelEl) {
    labelEl.textContent = num ? `✏️ ${num} Overs (Custom)` : '✏️ Custom Overs...';
  }
};

window.addSelectedPlayer = function (team) {
  const sel = document.getElementById(`${team}-player-select`);
  if (!sel) return;
  const name = sel.value.trim();
  if (!name) return;
  sel.value = '';
  addPlayer(team, name);
};

window.addPlayer = function (team, playerName) {
  let name = extractPlayerName(playerName);
  if (!name) {
    const sel = document.getElementById(`${team}-player-select`);
    if (sel && sel.value) name = extractPlayerName(sel.value);
  }
  if (!name) return toast('Please select a player to add');

  const match = state.room?.match;
  if (!match) return;

  const t1Players = (match.teams.team1?.players || []).map(p => extractPlayerName(p)).filter(Boolean);
  const t2Players = (match.teams.team2?.players || []).map(p => extractPlayerName(p)).filter(Boolean);

  if (t1Players.some(p => p.toLowerCase() === name.toLowerCase()) ||
    t2Players.some(p => p.toLowerCase() === name.toLowerCase())) {
    return toast('Player is already added to a team!');
  }

  const currentTeamPlayers = team === 'team1' ? t1Players : t2Players;
  currentTeamPlayers.push(name);

  const teams = {
    team1: { ...match.teams.team1, name: match.teams.team1?.name || 'Team 1', players: team === 'team1' ? currentTeamPlayers : t1Players },
    team2: { ...match.teams.team2, name: match.teams.team2?.name || 'Team 2', players: team === 'team2' ? currentTeamPlayers : t2Players }
  };

  // Optimistically update local state so tags show immediately
  state.room.match.teams = teams;
  renderTeamTags('team1');
  renderTeamTags('team2');
  populatePlayerSelects();
  updateTossButton();

  socket.emit('match:setup', { teams });
};

function renderTeamTags(team) {
  const match = state.room?.match;
  if (!match) return;
  const rawPlayers = match.teams[team]?.players || [];
  const players = rawPlayers.map(p => extractPlayerName(p)).filter(Boolean);
  const container = document.getElementById(`${team}-players`);
  const host = isHost();

  // Update count badge
  const countEl = document.getElementById(team === 'team1' ? 't1-count' : 't2-count');
  if (countEl) countEl.textContent = `${players.length} ${players.length === 1 ? 'Player' : 'Players'}`;

  const totalCountEl = document.getElementById('setup-player-count');
  if (totalCountEl) {
    const t1Len = (match.teams.team1?.players || []).map(p => extractPlayerName(p)).filter(Boolean).length;
    const t2Len = (match.teams.team2?.players || []).map(p => extractPlayerName(p)).filter(Boolean).length;
    totalCountEl.textContent = `👥 ${t1Len + t2Len} Players Assigned`;
  }

  if (!container) return;

  if (players.length === 0) {
    container.innerHTML = `<div class="team-empty-hint">No players added yet</div>`;
    return;
  }

  container.innerHTML = players.map((p, i) => `
    <span class="player-tag ${team === 'team1' ? 'tag-t1' : 'tag-t2'}">
      <span class="player-tag-name">${escHtml(p)}</span>
      ${host ? `<button class="tag-remove-btn" onclick="removePlayer('${team}',${i})" title="Remove ${escHtml(p)}">×</button>` : ''}
    </span>
  `).join('');
}

window.removePlayer = function (team, idx) {
  const match = state.room?.match;
  if (!match) return;
  const t1Players = (match.teams.team1?.players || []).map(p => extractPlayerName(p)).filter(Boolean);
  const t2Players = (match.teams.team2?.players || []).map(p => extractPlayerName(p)).filter(Boolean);

  if (team === 'team1') {
    t1Players.splice(idx, 1);
  } else {
    t2Players.splice(idx, 1);
  }

  const teams = {
    team1: { ...match.teams.team1, players: t1Players },
    team2: { ...match.teams.team2, players: t2Players }
  };
  // Optimistic local update
  state.room.match.teams = teams;
  renderTeamTags('team1');
  renderTeamTags('team2');
  populatePlayerSelects();
  updateTossButton();
  socket.emit('match:setup', { teams });
};

// Custom overs toggle
document.getElementById('setting-overs')?.addEventListener('change', function () {
  const customInput = document.getElementById('custom-overs-input');
  if (this.value === 'custom') {
    customInput.style.display = 'block';
    customInput.focus();
  } else {
    customInput.style.display = 'none';
  }
});

function getSelectedOvers() {
  const sel = document.getElementById('setting-overs');
  if (!sel) return 20;
  if (sel.value === 'custom') {
    const v = parseInt(document.getElementById('custom-overs-input')?.value);
    return (v > 0 && v <= 100) ? v : 20;
  }
  return parseInt(sel.value);
}

document.getElementById('btn-save-setup')?.addEventListener('click', () => {
  const teams = {
    team1: { name: document.getElementById('team1-name')?.value.trim() || 'Team 1', players: state.room.match.teams.team1.players },
    team2: { name: document.getElementById('team2-name')?.value.trim() || 'Team 2', players: state.room.match.teams.team2.players }
  };
  const overs = getSelectedOvers();
  if (!overs || overs < 1) return toast('Please enter a valid number of overs');
  socket.emit('match:setup', { teams, overs });
  toast(`✅ Setup saved! ${overs} overs per side.`);
  updateTossButton();
});

document.getElementById('btn-save-location')?.addEventListener('click', () => {
  const text = document.getElementById('location-text')?.value.trim() || '';
  const mapUrl = document.getElementById('location-map')?.value.trim() || '';
  socket.emit('match:setup', { location: { text, mapUrl } });
  toast('📍 Location saved!');
  renderPlanningLocation();
});

function updateTossButton() {
  const match = state.room?.match;
  if (!match) return;
  const tossBtn = document.getElementById('btn-toss');
  if (tossBtn) tossBtn.style.display = isHost() ? 'inline-flex' : 'none';

  const resetBtn = document.getElementById('btn-reset-match');
  if (resetBtn) resetBtn.style.display = isHost() ? 'inline-flex' : 'none';
}

document.getElementById('btn-toss')?.addEventListener('click', () => {
  if (!isHost()) return toast('Only the host can start the toss');
  const match = state.room?.match;
  if (!match) return;
  const t1Players = (match.teams?.team1?.players || []).map(p => extractPlayerName(p)).filter(Boolean);
  const t2Players = (match.teams?.team2?.players || []).map(p => extractPlayerName(p)).filter(Boolean);
  if (t1Players.length === 0 || t2Players.length === 0) {
    return toast('⚠️ Please add at least 1 player to both Team 1 and Team 2 before starting the toss');
  }
  showTossModal();
  socket.emit('match:startToss');
});

// ─── Match Reset Handlers ───
document.getElementById('btn-reset-match')?.addEventListener('click', () => {
  if (!isHost()) return toast('Only the host can reset the match');
  document.getElementById('reset-confirm-modal').style.display = 'flex';
});

document.getElementById('btn-cancel-reset')?.addEventListener('click', () => {
  document.getElementById('reset-confirm-modal').style.display = 'none';
});

document.getElementById('reset-confirm-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'reset-confirm-modal') {
    document.getElementById('reset-confirm-modal').style.display = 'none';
  }
});

document.getElementById('btn-confirm-reset')?.addEventListener('click', () => {
  if (!isHost()) return toast('Only the host can reset the match');
  const modal = document.getElementById('reset-confirm-modal');
  modal.style.display = 'none';

  socket.emit('match:reset', (res) => {
    if (res && !res.success) {
      toast('❌ ' + (res.error || 'Failed to reset match'));
    } else {
      toast('🔄 Match has been reset to Planning! Previous scoring archived.');
      // Switch back to setup tab
      document.querySelector('.tab[data-tab="setup"]')?.click();
    }
  });
});

// ══════════════════════════════════════════════
//  TOSS MODAL — Coin Flip (host only)
// ══════════════════════════════════════════════
function showTossModal() {
  if (!isHost()) return;  // ← non-hosts never see this
  const match = state.room?.match;
  if (!match) return;

  const t1Name = match.teams?.team1?.name || 'Team 1';
  const t2Name = match.teams?.team2?.name || 'Team 2';

  // Populate coin face labels with team initials
  const headsLabel = document.getElementById('coin-heads-label');
  const tailsLabel = document.getElementById('coin-tails-label');
  if (headsLabel) headsLabel.textContent = (t1Name[0] || '1').toUpperCase();
  if (tailsLabel) tailsLabel.textContent = (t2Name[0] || '2').toUpperCase();

  // Populate team labels row
  const teamLabelsEl = document.getElementById('toss-team-labels');
  if (teamLabelsEl) {
    teamLabelsEl.innerHTML = `
      <span class="toss-label-chip team1-bg">
        <span class="coin-heads-dot">H</span> ${escHtml(t1Name)}
      </span>
      <span class="toss-label-chip team2-bg">
        <span class="coin-tails-dot">T</span> ${escHtml(t2Name)}
      </span>`;
  }

  resetCoin();
  document.getElementById('toss-modal').style.display = 'flex';
  state.tossWinner = null;
}

window.flipCoin = function () {
  const match = state.room?.match;
  if (!match) return;

  const btn = document.getElementById('btn-flip-coin');
  btn.disabled = true;
  btn.textContent = 'Flipping…';

  const coin = document.getElementById('coin');
  coin.classList.remove('flip-heads', 'flip-tails');

  // Randomly decide result: 0 = heads (team1), 1 = tails (team2)
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  const winner = result === 'heads' ? 'team1' : 'team2';

  // Trigger CSS animation
  void coin.offsetWidth; // reflow
  coin.classList.add(result === 'heads' ? 'flip-heads' : 'flip-tails');

  setTimeout(() => {
    const winnerName = match.teams[winner].name;
    state.tossWinner = winner;

    // Show result phase
    document.getElementById('toss-phase-coin').style.display = 'none';
    document.getElementById('toss-phase-result').style.display = 'block';

    const badge = document.getElementById('coin-result-badge');
    badge.innerHTML = `
      <div class="coin-result-icon">${result === 'heads' ? '🟡' : '⚪'}</div>
      <div class="coin-result-team">${escHtml(winnerName)}</div>
      <div class="coin-result-sub">won the toss!</div>`;
    badge.className = 'coin-result-badge result-' + result;

    document.getElementById('toss-winner-name').textContent = winnerName;
  }, 1800); // wait for animation
};

window.resetCoin = function () {
  const coin = document.getElementById('coin');
  coin.classList.remove('flip-heads', 'flip-tails');
  document.getElementById('toss-phase-coin').style.display = 'block';
  document.getElementById('toss-phase-result').style.display = 'none';
  const btn = document.getElementById('btn-flip-coin');
  if (btn) { btn.disabled = false; btn.textContent = '🪙 Flip Coin'; }
  state.tossWinner = null;
};

window.doToss = function (choice) {
  if (!state.tossWinner) return toast('Flip the coin first!');
  socket.emit('match:toss', { winner: state.tossWinner, choice });
  document.getElementById('toss-modal').style.display = 'none';
};

// ══════════════════════════════════════════════
//  SCORECARD
// ══════════════════════════════════════════════
function renderScorecard() {
  const { room } = state;
  if (!room) return;
  const match = room.match;
  const wrap = document.getElementById('scorecard-wrap');
  if (!wrap) return;

  if (match.status === 'planning' || match.status === 'toss') {
    wrap.innerHTML = `<div class="empty-state-large"><div class="empty-icon">📊</div><p>Scorecard will appear once the match begins</p></div>`;
    return;
  }

  let html = '';
  match.innings.forEach((inn, idx) => {
    if (!inn.battingTeam) return;
    html += buildScorecardInnings(match, inn, idx,
      getTeamName(match, inn.battingTeam),
      getTeamName(match, inn.bowlingTeam),
      idx === match.currentInnings && !inn.completed
    );
  });
  wrap.innerHTML = html || `<div class="empty-state-large"><div class="empty-icon">📊</div><p>Match starting soon...</p></div>`;
}

function buildScorecardInnings(match, inn, idx, teamName, bowlTeamName, isCurrent) {
  const overs = formatOvers(inn.balls);
  const crr = inn.balls > 0 ? ((inn.runs / inn.balls) * 6).toFixed(2) : '0.00';
  const rrr = inn.target ? calcRRR(inn.target, inn.runs, inn.balls, match.overs * 6) : null;
  const hostUser = isHost();

  const outCount = (inn.batsmen || []).filter(b => b.out).length;
  const battingPlayers = getPlayerList(match, inn.battingTeam);
  const allBattersDismissed = (battingPlayers.length > 0 && outCount >= battingPlayers.length) || 
                              (inn.batsmen.length > 0 && outCount >= inn.batsmen.length && inn.currentBatsmen[0] === null && inn.currentBatsmen[1] === null);

  const isLastInnings = idx === 1 || idx === 3 || match.status === 'innings2' || match.status === 'super_over_inn2';

  let html = `<div class="sc-section">
    <div class="live-score-hero" style="margin-bottom:1rem">
      <div class="score-team">
        <div class="score-team-name">${escHtml(teamName)}</div>
        <div class="score-runs team1-score">${inn.runs}/${inn.wickets}</div>
        <div class="score-detail">${overs}/${match.overs} overs · CRR: ${crr}</div>
      </div>
      <div class="score-vs">${idx === 0 ? '1st' : '2nd'}<br>INN</div>
      <div class="score-info">
        ${inn.target ? `<div class="score-target">Target: ${inn.target}</div>
        <div class="score-rrr">RRR: ${rrr}</div>` : ''}
        <div style="font-size:0.8rem;color:var(--text-3)">${isCurrent ? '🔴 LIVE' : (inn.completed ? '✅ Done' : '')}</div>
        ${isCurrent && hostUser ? `<button class="btn btn-primary btn-sm" onclick="declareAllOut()" style="margin-top:0.4rem;font-size:0.75rem;padding:0.35rem 0.75rem;font-weight:700">${isLastInnings ? '🏆 End Match' : '🏁 End Innings'}</button>` : ''}
      </div>
    </div>`;

  if (isCurrent && (inn.awaitingNewBatsman || allBattersDismissed)) {
    html += `
    <div class="awaiting-bowler-notice" onclick="${allBattersDismissed ? 'declareAllOut()' : 'openNextBatsmanModal()'}" style="cursor:pointer;background:rgba(255,82,82,0.15);border:1px solid rgba(255,82,82,0.4);margin-bottom:1rem;padding:0.85rem 1rem;border-radius:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem">
      <div>
        <div style="font-weight:800;color:var(--danger)">${allBattersDismissed ? (isLastInnings ? '🏆 All Batters Out' : '🏁 All Batters Out') : '💥 Wicket fell'} (${inn.runs}/${inn.wickets})</div>
        <div style="font-size:0.8rem;color:var(--text-2)">${allBattersDismissed ? (isLastInnings ? 'Match finished. Click to view match result.' : 'No more batters available. Click to end innings and start 2nd Innings.') : 'Tap here to choose next batter or declare innings complete'}</div>
      </div>
      ${hostUser ? `<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); declareAllOut()" style="font-weight:800;padding:0.4rem 0.9rem">${isLastInnings ? '🏆 Complete Match (View Result)' : '🏁 End Innings (Switch Sides)'}</button>` : ''}
    </div>`;
  }

  // Batting
  html += `<div class="sc-section-title">Batting — ${escHtml(teamName)}</div>
  <div class="sc-table-wrap">
    <table class="sc-table">
      <tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th><th>Status</th></tr>`;
  inn.batsmen.forEach((b, bi) => {
    const isStriker = bi === inn.currentBatsmen[0];
    const isNS = bi === inn.currentBatsmen[1];
    const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(0) : '—';
    html += `<tr class="${b.out ? 'batting-out' : (isStriker ? 'sc-on-strike' : '')}">
      <td class="sc-name player-profile-link" onclick="openPlayerProfile('${escHtml(b.name)}')" title="View Player Profile">${isStriker ? '🏏 ' : (isNS ? '⬡ ' : '')}${escHtml(b.name)}</td>
      <td class="sc-runs">${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${sr}</td>
      <td style="font-size:0.75rem;color:var(--text-3)">${b.out ? (b.dismissal || 'Out') : (isStriker ? 'Batting*' : (isNS ? 'NStriker' : 'Yet'))}</td>
    </tr>`;
  });
  if (!inn.batsmen.length) html += `<tr><td colspan="7" style="color:var(--text-3);padding:0.5rem">No batsmen set</td></tr>`;
  html += `</table></div>`;

  const totalBatRuns = inn.batsmen.reduce((s, b) => s + b.runs, 0);
  const ex = inn.extras;
  html += `<div style="font-size:0.8rem;color:var(--text-2);margin:0.4rem 0">
    Extras: ${inn.runs - totalBatRuns} (Wd ${ex.wide}, Nb ${ex.noBall}, B ${ex.bye}, Lb ${ex.legBye})
  </div>`;

  // Bowling
  html += `<div class="sc-section-title" style="margin-top:0.75rem">Bowling — ${escHtml(bowlTeamName)}</div>
  <div class="sc-table-wrap">
    <table class="sc-table">
      <tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Eco</th></tr>`;
  inn.bowlers.forEach((b, bi) => {
    const isCurBowler = bi === inn.currentBowler;
    const eco = b.overs > 0 ? (b.runs / b.overs).toFixed(2) : '—';
    html += `<tr class="${isCurBowler ? 'sc-on-strike' : ''}">
      <td class="sc-name player-profile-link" onclick="openPlayerProfile('${escHtml(b.name)}')" title="View Player Profile">${isCurBowler ? '⚾ ' : ''}${escHtml(b.name)}</td>
      <td>${b.overs}</td><td>${b.maidens}</td><td>${b.runs}</td><td class="sc-runs">${b.wickets}</td><td>${eco}</td>
    </tr>`;
  });
  if (!inn.bowlers.length) html += `<tr><td colspan="6" style="color:var(--text-3);padding:0.5rem">No bowlers set</td></tr>`;
  html += `</table></div>`;

  // Over log
  html += `<div class="sc-section-title" style="margin-top:0.75rem">Over-by-Over</div><div class="over-log">`;
  inn.ballLog.forEach((over, i) => {
    const pills = over.map(b => `<span class="over-pill ${b === 'W' ? 'wicket' : b === '4' ? 'four' : b === '6' ? 'six' : b === 'Wd' ? 'wide' : ''}">${b}</span>`).join('');
    html += `<div style="display:flex;gap:0.2rem;align-items:center"><span style="font-size:0.7rem;color:var(--text-3);min-width:24px">O${i + 1}:</span>${pills}</div>`;
  });
  if (inn.currentOver.length > 0) {
    const pills = inn.currentOver.map(b => `<span class="over-pill ${b === 'W' ? 'wicket' : b === '4' ? 'four' : b === '6' ? 'six' : b === 'Wd' ? 'wide' : ''}">${b}</span>`).join('');
    html += `<div style="display:flex;gap:0.2rem;align-items:center"><span style="font-size:0.7rem;color:var(--primary);min-width:24px">Now:</span>${pills}</div>`;
  }
  html += `</div></div>`;
  return html;
}

// ══════════════════════════════════════════════
//  SCORING PANEL
// ══════════════════════════════════════════════
function renderScoringPanel() {
  const { room } = state;
  if (!room) return;
  const match = room.match;
  const panel = document.getElementById('scoring-panel');
  if (!panel) return;

  if (match.status === 'planning' || match.status === 'toss') {
    panel.innerHTML = `<div class="empty-state-large"><div class="empty-icon">⚾</div><p>Scoring becomes available once the match starts</p></div>`;
    return;
  }
  if (match.status === 'completed') {
    panel.innerHTML = `<div class="empty-state-large"><div class="empty-icon">🏆</div><p>Match has ended!</p></div>`;
    return;
  }

  const idx = match.currentInnings;
  const inn = match.innings[idx];
  if (!inn || inn.completed) {
    panel.innerHTML = `<div class="empty-state-large"><div class="empty-icon">✅</div><p>Innings completed</p></div>`;
    return;
  }

  const teamName = getTeamName(match, inn.battingTeam);
  const strikerObj = inn.currentBatsmen[0] !== null ? inn.batsmen[inn.currentBatsmen[0]] : null;
  const nonStrikerObj = inn.currentBatsmen[1] !== null ? inn.batsmen[inn.currentBatsmen[1]] : null;
  const bowlerObj = inn.currentBowler !== null ? inn.bowlers[inn.currentBowler] : null;

  const crr = inn.balls > 0 ? ((inn.runs / inn.balls) * 6).toFixed(2) : '0.00';
  const rrr = inn.target ? calcRRR(inn.target, inn.runs, inn.balls, match.overs * 6) : null;
  const overBalls = inn.currentOver.map(b =>
    `<span class="over-pill ${b === 'W' ? 'wicket' : b === '4' ? 'four' : b === '6' ? 'six' : (b === 'Wd' || b === 'Nb') ? 'wide' : ''}">${b}</span>`
  ).join('');

  function batsmanRow(b, isStriker) {
    if (!b) {
      if (inn.isSingleBatter && !isStriker) {
        return `<tr><td colspan="6" class="mini-not-set" style="color:var(--text-3);font-style:italic">👤 Single Batter Mode (No non-striker)</td></tr>`;
      }
      return `<tr><td colspan="6" class="mini-not-set" style="color:var(--danger)">${isStriker ? '⚡ Awaiting Striker (Pick Next Batter)' : '◇ Non-striker: not set'}</td></tr>`;
    }
    const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(0) : '—';
    const soloTag = (inn.isSingleBatter && isStriker) ? ' <span style="font-size:0.75rem;color:var(--primary);font-weight:700">[Solo]</span>' : '';
    return `<tr class="${isStriker ? 'mini-striker' : 'mini-ns'}">
      <td><span class="mini-bat-icon">${isStriker ? '🏏' : '◇'}</span> ${escHtml(b.name)}${soloTag}</td>
      <td class="mini-bold ${isStriker ? 'mini-primary' : ''}">${b.runs}</td>
      <td>${b.balls}</td>
      <td class="mini-four">${b.fours}</td>
      <td class="mini-six">${b.sixes}</td>
      <td class="mini-muted">${sr}</td>
    </tr>`;
  }

  function bowlerRow(b) {
    if (!b) return `<tr><td colspan="5" class="mini-not-set">Bowler not set</td></tr>`;
    const eco = b.overs > 0 ? (b.runs / b.overs).toFixed(2) : '—';
    const currentBalls = inn.balls % 6;
    return `<tr>
      <td><span class="mini-bowl-icon">⚾</span> ${escHtml(b.name)}</td>
      <td>${b.overs}.${currentBalls}</td>
      <td>${b.runs}</td>
      <td class="mini-bold ${b.wickets > 0 ? 'mini-danger' : ''}">${b.wickets}</td>
      <td class="mini-muted">${eco}</td>
    </tr>`;
  }

  const canUndo = inn.canUndo ?? false;
  const canRedo = inn.canRedo ?? false;

  const hostUser = isHost();
  const isLastInnings = idx === 1 || idx === 3 || match.status === 'innings2' || match.status === 'super_over_inn2';
  const outCount = (inn.batsmen || []).filter(b => b.out).length;
  const battingPlayers = getPlayerList(match, inn.battingTeam);
  const allBattersDismissed = (battingPlayers.length > 0 && outCount >= battingPlayers.length) || 
                              (inn.batsmen.length > 0 && outCount >= inn.batsmen.length && inn.currentBatsmen[0] === null && inn.currentBatsmen[1] === null);

  panel.innerHTML = `
    <div class="scoring-live-badge">
      <div class="live-dot"></div>
      <span style="font-weight:700;color:var(--danger)">LIVE</span>
      <span style="color:var(--text-2);font-size:0.82rem">— ${escHtml(teamName)} batting${inn.isSingleBatter ? ' (Single Batter Mode)' : ''}</span>
      ${hostUser ? `<div class="undo-redo-group">
        <button class="undo-redo-btn${canUndo ? '' : ' disabled'}"
          onclick="undoBall()" ${canUndo ? '' : 'disabled'} title="Undo last ball">↩ Undo</button>
        <button class="undo-redo-btn${canRedo ? '' : ' disabled'}"
          onclick="redoBall()" ${canRedo ? '' : 'disabled'} title="Redo">↪ Redo</button>
      </div>` : ''}
    </div>

    <div class="score-mini-display">
      <div class="score-mini-runs">${inn.runs}/${inn.wickets}</div>
      <div class="score-mini-detail">
        ${formatOvers(inn.balls)} overs · CRR ${crr}${rrr ? ` · RRR ${rrr}` : ''}${inn.target ? ` · Target ${inn.target}` : ''}
      </div>
      <div class="score-mini-over-log">
        ${overBalls || '<span style="color:var(--text-3);font-size:0.78rem">No balls yet this over</span>'}
      </div>
    </div>

    ${(inn.awaitingNewBatsman || allBattersDismissed) && hostUser ? `
    <div class="awaiting-bowler-notice" onclick="${allBattersDismissed ? 'declareAllOut()' : 'openNextBatsmanModal()'}" style="cursor:pointer;background:rgba(255,82,82,0.15);border-color:rgba(255,82,82,0.4)">
      <div class="awaiting-bowler-icon">${allBattersDismissed ? (isLastInnings ? '🏆' : '🏁') : '💥'}</div>
      <div class="awaiting-bowler-text">
        ${allBattersDismissed ? (isLastInnings ? `🏆 All Batters Out (${inn.runs}/${inn.wickets}) — Match Finished!` : `🏁 All Batters Out (${inn.runs}/${inn.wickets}) — Innings Complete!`) : `Wicket fell (${inn.runs}/${inn.wickets}) — choose next batter!`}
        <small>${allBattersDismissed ? (isLastInnings ? 'Tap here to complete match and view summary' : 'Tap here to end innings and start 2nd innings') : 'Tap here to select next batter or continue in single batter mode'}</small>
      </div>
      <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); declareAllOut()" style="font-weight:800;padding:0.35rem 0.8rem;margin-left:auto">${isLastInnings ? '🏆 View Result' : '🏁 End Innings'}</button>
    </div>` : ((inn.awaitingNewBatsman || allBattersDismissed) && !hostUser ? `
    <div class="awaiting-bowler-notice" style="background:rgba(255,82,82,0.1);border-color:rgba(255,82,82,0.3)">
      <div class="awaiting-bowler-icon">${isLastInnings ? '🏆' : '⏳'}</div>
      <div class="awaiting-bowler-text">
        ${allBattersDismissed ? (isLastInnings ? 'All batters are out. Match completed!' : 'All batters are out. Waiting for host to switch innings...') : 'Wicket fell — Next batter is walking out to the crease...'}
      </div>
    </div>` : '')}

    ${inn.awaitingNewBowler && hostUser ? `
    <div class="awaiting-bowler-notice" onclick="openBowlerModal(true)" style="cursor:pointer">
      <div class="awaiting-bowler-icon">🔄</div>
      <div class="awaiting-bowler-text">
        Over ${inn.ballLog.length} complete — pick a new bowler!
        <small>Strike has changed · Tap here to select bowler for Over ${inn.ballLog.length + 1}</small>
      </div>
    </div>` : ''}

    <div class="mini-stats-grid">
      <div class="mini-stats-card">
        <div class="mini-stats-title">🏏 At the Crease</div>
        <table class="mini-stats-table">
          <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
          <tbody>
            ${batsmanRow(strikerObj, true)}
            ${batsmanRow(nonStrikerObj, false)}
          </tbody>
        </table>
      </div>
      <div class="mini-stats-card">
        <div class="mini-stats-title">⚾ Bowling</div>
        <table class="mini-stats-table">
          <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Eco</th></tr></thead>
          <tbody>${bowlerRow(bowlerObj)}</tbody>
        </table>
      </div>
    </div>

    ${hostUser ? `
    <div class="glass-card">
      <div class="scoring-controls">
        <div>
          <div class="scoring-label">RUNS</div>
          <div class="runs-grid">
            ${[0, 1, 2, 3, '4', '5', '6'].map(r => `
              <button class="run-btn ${r == '4' ? 'four-btn' : ''} ${r == '6' ? 'six-btn' : ''}"
                onclick="selectRun(${r})" id="run-${r}">${r}</button>
            `).join('')}
          </div>
        </div>
        <div>
          <div class="scoring-label">EXTRAS</div>
          <div class="extras-row">
            <button class="extra-btn" id="extra-wide"   onclick="toggleExtra('wide')">Wide (+1)</button>
            <button class="extra-btn" id="extra-noBall" onclick="toggleExtra('noBall')">No Ball (+1)</button>
            <button class="extra-btn" id="extra-bye"    onclick="toggleExtra('bye')">Bye</button>
            <button class="extra-btn" id="extra-legBye" onclick="toggleExtra('legBye')">Leg Bye</button>
          </div>
        </div>
        <div>
          <div class="scoring-label">WICKET</div>
          <div class="wicket-section">
            <button class="wicket-toggle" id="wicket-toggle" onclick="toggleWicket()">🚫 Wicket</button>
            
            <div id="wicket-details-panel" style="display:${state.pendingWicket ? 'block' : 'none'};margin-top:0.75rem;padding:0.75rem;background:rgba(255,82,82,0.08);border:1px solid rgba(255,82,82,0.3);border-radius:10px">
              <div style="font-size:0.75rem;font-weight:700;color:var(--danger);margin-bottom:0.4rem;display:flex;justify-content:space-between;align-items:center">
                <span>DISMISSAL TYPE</span>
                <span style="font-size:0.7rem;font-weight:700;color:${state.pendingDismissalType === 'Run Out' ? '#ffab00' : '#00e5ff'}">
                  ${state.pendingDismissalType === 'Run Out' ? '🏃 Fielding (No Bowler Wicket)' : '⚾ Bowler\'s Wicket (+1 W)'}
                </span>
              </div>
              <div class="dismissal-pills-grid" style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-bottom:0.6rem">
                ${['Bowled', 'Caught', 'LBW', 'Stumped', 'Hit Wicket', 'Run Out'].map(d => `
                  <button type="button" class="btn btn-sm ${state.pendingDismissalType === d ? 'btn-primary' : 'btn-ghost'}" 
                    style="padding:0.25rem 0.55rem;font-size:0.75rem;font-weight:700" 
                    onclick="selectDismissalType('${d}')">${d}</button>
                `).join('')}
              </div>

              ${state.pendingDismissalType === 'Run Out' ? `
                <div id="runout-batsman-select" style="margin-bottom:0.75rem;padding:0.75rem;background:rgba(0,0,0,0.35);border-radius:10px;border:1px solid rgba(255,171,0,0.4)">
                  <div style="font-size:0.78rem;font-weight:800;color:#ffab00;margin-bottom:0.45rem;display:flex;align-items:center;gap:0.35rem">
                    <span>🏃</span> WHO GOT RUN OUT?
                  </div>
                  <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem">
                    <button type="button" class="btn btn-sm ${state.pendingDismissedSlot === 'striker' ? 'btn-primary' : 'btn-ghost'}" 
                      style="flex:1;min-width:130px;font-size:0.8rem;font-weight:700;padding:0.45rem 0.6rem;${state.pendingDismissedSlot === 'striker' ? 'box-shadow:0 0 10px rgba(0,229,255,0.4);' : ''}" 
                      onclick="selectDismissedSlot('striker')">
                      🏏 Striker (${escHtml(strikerObj?.name || 'Striker')})
                    </button>
                    ${(!inn.isSingleBatter && (nonStrikerObj || inn.currentBatsmen[1] !== null)) ? `
                    <button type="button" class="btn btn-sm ${state.pendingDismissedSlot === 'non_striker' ? 'btn-primary' : 'btn-ghost'}" 
                      style="flex:1;min-width:130px;font-size:0.8rem;font-weight:700;padding:0.45rem 0.6rem;${state.pendingDismissedSlot === 'non_striker' ? 'box-shadow:0 0 10px rgba(0,229,255,0.4);' : ''}" 
                      onclick="selectDismissedSlot('non_striker')">
                      ◇ Non-Striker (${escHtml(nonStrikerObj?.name || 'Non-Striker')})
                    </button>
                    ` : ''}
                  </div>

                  <div style="font-size:0.78rem;font-weight:800;color:#00e5ff;margin-bottom:0.45rem;display:flex;align-items:center;gap:0.35rem">
                    <span>⚡</span> RUNS COMPLETED BEFORE RUN OUT
                  </div>
                  <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.35rem">
                    ${[0, 1, 2, 3].map(r => `
                      <button type="button" class="btn btn-sm ${(state.pendingRuns === r || (state.pendingRuns === null && r === 0)) ? 'btn-primary' : 'btn-ghost'}"
                        style="flex:1;min-width:65px;font-size:0.8rem;font-weight:800;padding:0.4rem 0.6rem;${(state.pendingRuns === r || (state.pendingRuns === null && r === 0)) ? 'background:#00e5ff;color:#080c14;box-shadow:0 0 10px rgba(0,229,255,0.5);' : ''}"
                        onclick="selectRunOutCompletedRuns(${r})">
                        ${r === 0 ? '0 (No Run)' : `${r} ${r === 1 ? 'Run' : 'Runs'}`}
                      </button>
                    `).join('')}
                  </div>
                  <div style="font-size:0.72rem;color:var(--text-3);margin-top:0.35rem">
                    ${(state.pendingRuns && state.pendingRuns > 0) ? `✅ ${state.pendingRuns} ${state.pendingRuns === 1 ? 'run' : 'runs'} will be added to team & batter total.` : 'No runs added (run out on delivery).'}
                  </div>
                </div>
              ` : ''}

              <input type="text" class="dismissal-input form-control" id="dismissal-input"
                value="${escHtml(state.pendingDismissalNote || '')}"
                oninput="state.pendingDismissalNote = this.value"
                placeholder="${state.pendingDismissalType === 'Caught' ? 'e.g. c Kohli (or leave blank for c & b ' + (bowlerObj?.name || 'Bowler') + ')' : (state.pendingDismissalType === 'Stumped' ? 'e.g. st Dhoni (or leave blank for st b ' + (bowlerObj?.name || 'Bowler') + ')' : (state.pendingDismissalType === 'Run Out' ? 'e.g. Direct hit by Jadeja' : 'Optional custom note (e.g. b ' + (bowlerObj?.name || 'Bowler') + ')'))}" 
                style="width:100%;font-size:0.8rem;padding:0.4rem 0.6rem" />
            </div>
          </div>
        </div>
        <button class="commit-btn" onclick="commitBall()">✅ Record Ball</button>
      </div>
    </div>
    <div style="display:flex;gap:0.75rem;margin-top:0.5rem;flex-wrap:wrap">
      <button class="btn btn-ghost" style="flex:1;min-width:110px" onclick="openBatsmenModal()">🏏 Set Batsmen</button>
      <button class="btn btn-ghost" style="flex:1;min-width:110px" onclick="openBowlerModal()">⚾ Set Bowler</button>
      <button class="btn btn-ghost" style="flex:1;min-width:110px;color:var(--danger);border-color:rgba(255,82,82,0.35)" onclick="declareAllOut()">${isLastInnings ? '🏆 End Match' : '🏁 End Innings'}</button>
    </div>
    ` : `
    <div class="glass-card" style="text-align:center;padding:1.5rem">
      <div style="font-size:1.5rem;margin-bottom:0.5rem">👀</div>
      <div style="color:var(--text-2);font-size:0.9rem">You're viewing live — only the host can score</div>
    </div>
    `}
  `;

  if (state.pendingRuns !== null) document.getElementById(`run-${state.pendingRuns}`)?.classList.add('selected');
  Object.keys(state.pendingExtras).forEach(k => {
    if (state.pendingExtras[k]) document.getElementById(`extra-${k}`)?.classList.add('selected');
  });
  if (state.pendingWicket) {
    document.getElementById('wicket-toggle')?.classList.add('active');
  }
}

window.selectRun = function (r) {
  state.pendingRuns = parseInt(r) || 0;
  // If wicket is active and NOT Run Out, selecting a non-zero run turns off wicket (runs and normal wickets are mutually exclusive)
  if (state.pendingWicket && state.pendingDismissalType !== 'Run Out' && state.pendingRuns > 0) {
    state.pendingWicket = false;
    document.getElementById('wicket-toggle')?.classList.remove('active');
    const wp = document.getElementById('wicket-details-panel');
    if (wp) wp.style.display = 'none';
  }
  document.querySelectorAll('.run-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById(`run-${r}`)?.classList.add('selected');
};

window.selectRunOutCompletedRuns = function (r) {
  state.pendingRuns = parseInt(r) || 0;
  renderScoringPanel();
};

window.toggleExtra = function (type) {
  state.pendingExtras[type] = !state.pendingExtras[type];
  if (type === 'wide' && state.pendingExtras.wide) state.pendingExtras.noBall = false;
  if (type === 'noBall' && state.pendingExtras.noBall) state.pendingExtras.wide = false;
  ['wide', 'noBall', 'bye', 'legBye'].forEach(k =>
    document.getElementById(`extra-${k}`)?.classList.toggle('selected', !!state.pendingExtras[k]));
};

window.toggleWicket = function () {
  state.pendingWicket = !state.pendingWicket;
  if (state.pendingWicket) {
    if (!state.pendingDismissalType) state.pendingDismissalType = 'Bowled';
    if (!state.pendingDismissedSlot) state.pendingDismissedSlot = 'striker';
    // Wicket priority: reset runs to 0 unless Run Out
    if (state.pendingDismissalType !== 'Run Out') {
      state.pendingRuns = 0;
    }
  }
  renderScoringPanel();
};

window.selectDismissalType = function (type) {
  state.pendingDismissalType = type;
  if (type !== 'Run Out') {
    state.pendingRuns = 0;
    state.pendingDismissedSlot = 'striker';
  }
  renderScoringPanel();
};

window.selectDismissedSlot = function (slot) {
  state.pendingDismissedSlot = slot;
  renderScoringPanel();
};

window.commitBall = function () {
  if (!isHost()) return toast('Only the host can score');
  if (state.pendingRuns === null) state.pendingRuns = 0;
  const match = state.room?.match;
  if (!match) return;
  const idx = match.currentInnings;
  const inn = match.innings[idx];
  
  if (inn.awaitingNewBatsman) {
    openNextBatsmanModal();
    return toast('⚠️ Please select the next batter first!');
  }
  if (inn.awaitingNewBowler) {
    openBowlerModal(true);
    return toast('⚠️ Please select a new bowler first!');
  }
  if (inn.currentBatsmen[0] === null) {
    openBatsmenModal();
    return toast('⚠️ Please set striker at the crease!');
  }
  if (!inn.isSingleBatter && inn.currentBatsmen[1] === null) {
    openBatsmenModal();
    return toast('⚠️ Please set both batsmen or switch to Single Batter Mode!');
  }
  if (inn.currentBowler === null) {
    openBowlerModal();
    return toast('⚠️ Set a bowler first!');
  }

  // Wicket priority: if wicket is true and not Run Out, runs must be 0
  let finalRuns = state.pendingRuns ?? 0;
  if (state.pendingWicket && state.pendingDismissalType !== 'Run Out') {
    finalRuns = 0;
  }

  const customNote = state.pendingDismissalNote || document.getElementById('dismissal-input')?.value || '';
  const dismissalText = state.pendingWicket ? (customNote.trim() || state.pendingDismissalType || 'out') : null;

  socket.emit('score:ball', {
    inningsIdx: idx,
    runs: finalRuns,
    extras: Object.values(state.pendingExtras).some(Boolean) ? { ...state.pendingExtras } : null,
    wicket: state.pendingWicket,
    dismissal: dismissalText,
    dismissalType: state.pendingWicket ? state.pendingDismissalType : null,
    dismissedSlot: state.pendingWicket ? (state.pendingDismissedSlot || 'striker') : null,
    token: state.session?.token
  });
  state.pendingRuns = null;
  state.pendingExtras = {};
  state.pendingWicket = false;
  state.pendingDismissalNote = '';
};

// ── Undo / Redo ───────────────────────────────
window.undoBall = function () {
  if (!isHost()) return toast('Only the host can undo');
  const match = state.room?.match;
  if (!match) return;
  const idx = match.currentInnings;
  const inn = match.innings[idx];
  if (!inn?.canUndo) return toast('Nothing to undo');
  socket.emit('score:undo', { inningsIdx: idx });
  toast('↩ Last ball undone');
};

window.redoBall = function () {
  if (!isHost()) return toast('Only the host can redo');
  const match = state.room?.match;
  if (!match) return;
  const idx = match.currentInnings;
  const inn = match.innings[idx];
  if (!inn?.canRedo) return toast('Nothing to redo');
  socket.emit('score:redo', { inningsIdx: idx });
  toast('↪ Ball re-applied');
};

// Toggle single batter mode in opening batsmen modal
window.toggleInitialSingleBatter = function (checked) {
  const group = document.getElementById('nonstriker-select-group');
  if (group) group.style.display = checked ? 'none' : 'block';
};

// Opening Batsmen Modal
window.openBatsmenModal = function () {
  const match = state.room?.match;
  if (!match) return;
  const idx = match.currentInnings;
  const inn = match.innings[idx];
  if (!inn) return;

  // Gather team squad players
  let players = getPlayerList(match, inn.battingTeam);

  // If squad list is empty, fallback to room planning members or existing registered players
  if (players.length === 0) {
    const planningNames = Object.values(state.room?.planning?.members || {}).map(m => m.name?.trim()).filter(Boolean);
    const existingBatsmen = (inn.batsmen || []).map(b => b.name?.trim()).filter(Boolean);
    const combined = Array.from(new Set([...planningNames, ...existingBatsmen]));
    if (combined.length > 0) players = combined;
  }

  const strikerEl = document.getElementById('select-striker');
  const nonStrikerEl = document.getElementById('select-nonstriker');
  const strikerCustom = document.getElementById('input-striker-custom');
  const nonStrikerCustom = document.getElementById('input-nonstriker-custom');

  if (strikerCustom) strikerCustom.value = '';
  if (nonStrikerCustom) nonStrikerCustom.value = '';

  if (players.length > 0) {
    const options = players.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
    if (strikerEl) strikerEl.innerHTML = options;
    if (nonStrikerEl) nonStrikerEl.innerHTML = options;
  } else {
    if (strikerEl) strikerEl.innerHTML = '<option value="">-- Type name below --</option>';
    if (nonStrikerEl) nonStrikerEl.innerHTML = '<option value="">-- Type name below --</option>';
  }

  if (inn.currentBatsmen[0] !== null && inn.batsmen[inn.currentBatsmen[0]]) {
    if (strikerEl) strikerEl.value = inn.batsmen[inn.currentBatsmen[0]].name;
  } else if (players.length > 0 && strikerEl) {
    strikerEl.value = players[0];
  }

  if (inn.currentBatsmen[1] !== null && inn.batsmen[inn.currentBatsmen[1]]) {
    if (nonStrikerEl) nonStrikerEl.value = inn.batsmen[inn.currentBatsmen[1]].name;
  } else if (players.length > 1 && nonStrikerEl) {
    nonStrikerEl.value = players[1];
  }
  
  const checkSingle = document.getElementById('check-single-batter-initial');
  if (checkSingle) {
    checkSingle.checked = !!inn.isSingleBatter;
    toggleInitialSingleBatter(checkSingle.checked);
  }
  document.getElementById('batsmen-modal').style.display = 'flex';
};

document.getElementById('btn-confirm-batsmen')?.addEventListener('click', () => {
  const strikerSel = document.getElementById('select-striker')?.value?.trim();
  const strikerCustom = document.getElementById('input-striker-custom')?.value?.trim();
  const striker = strikerCustom || (strikerSel && strikerSel !== 'No players' ? strikerSel : '');

  const nonStrikerSel = document.getElementById('select-nonstriker')?.value?.trim();
  const nonStrikerCustom = document.getElementById('input-nonstriker-custom')?.value?.trim();
  const isSingle = document.getElementById('check-single-batter-initial')?.checked;
  const nonStriker = isSingle ? '' : (nonStrikerCustom || (nonStrikerSel && nonStrikerSel !== 'No players' ? nonStrikerSel : ''));

  if (!striker) return toast('⚠️ Please select or enter a striker name!');
  if (!isSingle && !nonStriker) return toast('⚠️ Please select or enter a non-striker (or check Single Batter Mode)!');
  if (!isSingle && striker.toLowerCase().trim() === nonStriker.toLowerCase().trim()) return toast('⚠️ Striker and non-striker must differ!');

  socket.emit('score:setBatsmen', {
    inningsIdx: state.room.match.currentInnings,
    striker,
    nonStriker: isSingle ? '' : nonStriker,
    isSingleBatter: !!isSingle,
    token: state.session?.token
  }, (res) => {
    if (res && !res.success) {
      toast(`❌ ${res.error || 'Failed to set batsmen'}`);
    } else {
      toast('🏏 Batsmen set!');
    }
  });
  document.getElementById('batsmen-modal').style.display = 'none';
});

// Next Batsman Modal (After Wicket)
window.openNextBatsmanModal = function () {
  const match = state.room?.match;
  if (!match) return;
  const idx = match.currentInnings;
  const inn = match.innings[idx];
  if (!inn || inn.completed || match.status === 'completed') {
    const m = document.getElementById('next-batsman-modal');
    if (m) m.style.display = 'none';
    return;
  }
  const players = getPlayerList(match, inn.battingTeam);

  // Find who is already out
  const outNames = new Set((inn.batsmen || []).filter(b => b.out).map(b => b.name.toLowerCase().trim()));

  // Check if non-striker or striker is surviving at the crease (not out)
  const nonStrikerIdx = inn.currentBatsmen?.[1];
  const strikerIdx = inn.currentBatsmen?.[0];
  const hasSurvivingNonStriker = nonStrikerIdx !== null && inn.batsmen?.[nonStrikerIdx] && !inn.batsmen[nonStrikerIdx].out;
  const hasSurvivingStriker = strikerIdx !== null && inn.batsmen?.[strikerIdx] && !inn.batsmen[strikerIdx].out;
  const hasSurvivingBatter = hasSurvivingNonStriker || hasSurvivingStriker;
  const survivingBatterName = hasSurvivingNonStriker ? inn.batsmen[nonStrikerIdx].name : (hasSurvivingStriker ? inn.batsmen[strikerIdx].name : '');

  // Current players at crease (names)
  const currentCreaseNames = new Set(
    (inn.currentBatsmen || [])
      .map(i => (i !== null && inn.batsmen[i]) ? inn.batsmen[i].name.toLowerCase().trim() : null)
      .filter(Boolean)
  );

  // Available bench players: on roster, neither marked out nor currently occupying crease
  const availablePlayers = players.filter(p => !outNames.has(p.toLowerCase().trim()) && !currentCreaseNames.has(p.toLowerCase().trim()));

  const allBattersOut = !hasSurvivingBatter && availablePlayers.length === 0;

  const titleEl = document.getElementById('next-batsman-title');
  const subEl = document.getElementById('next-batsman-sub');
  const selectGroup = document.getElementById('group-available-teammates');
  const customGroup = document.getElementById('group-custom-batter');
  const btnConfirm = document.getElementById('btn-confirm-next-batsman');
  const btnSingle = document.getElementById('btn-continue-single-batter');
  const btnAllOut = document.getElementById('btn-declare-all-out');

  const isLastInnings = idx === 1 || idx === 3 || match.status === 'innings2' || match.status === 'super_over_inn2';

  if (allBattersOut) {
    // CASE 1: All batters are out (0 surviving at crease & 0 bench) -> auto complete innings/match directly without popup!
    const m = document.getElementById('next-batsman-modal');
    if (m) m.style.display = 'none';
    declareAllOut();
    return;
  } else if (hasSurvivingBatter && availablePlayers.length === 0) {
    // CASE 2: No bench players, but 1 batter survives at crease
    if (titleEl) titleEl.innerHTML = '💥 Wicket! 1 Batter Remaining';
    if (subEl) subEl.innerHTML = `Score: ${inn.runs}/${inn.wickets} (${formatOvers(inn.balls)} ov). No more bench players. Continue with ${escHtml(survivingBatterName)} (Solo) or end innings.`;
    if (selectGroup) selectGroup.style.display = 'none';
    if (customGroup) customGroup.style.display = 'none';
    if (btnConfirm) btnConfirm.style.display = 'none';
    if (btnSingle) {
      btnSingle.style.display = 'block';
      btnSingle.className = 'btn btn-primary btn-full';
      btnSingle.innerHTML = `👤 Play with 1 Batter (${escHtml(survivingBatterName)} Solo)`;
    }
    if (btnAllOut) {
      btnAllOut.style.display = 'block';
      btnAllOut.className = 'btn btn-ghost btn-full';
      btnAllOut.innerHTML = isLastInnings ? '🏆 All Out / View Result' : '🏁 All Out / Start 2nd Innings';
    }
  } else {
    // CASE 3: Bench players available
    if (titleEl) titleEl.innerHTML = '💥 Wicket! Select Next Batter';
    if (subEl) subEl.innerHTML = `Score: ${inn.runs}/${inn.wickets} (${formatOvers(inn.balls)} ov). Choose incoming batter from bench${hasSurvivingBatter ? ` or play solo with ${escHtml(survivingBatterName)}` : ''}.`;
    if (selectGroup) selectGroup.style.display = 'block';
    if (customGroup) customGroup.style.display = 'block';
    if (btnConfirm) {
      btnConfirm.style.display = 'block';
      btnConfirm.className = 'btn btn-primary btn-full';
      btnConfirm.innerHTML = '🏏 Confirm Next Batter';
    }

    const selectEl = document.getElementById('select-next-batsman');
    if (selectEl) {
      selectEl.innerHTML = availablePlayers.map(p => `<option value="${escHtml(p)}">${escHtml(p)}</option>`).join('');
    }

    if (btnSingle) {
      if (hasSurvivingBatter) {
        btnSingle.style.display = 'block';
        btnSingle.className = 'btn btn-secondary btn-full';
        btnSingle.innerHTML = `👤 Play with 1 Batter (${escHtml(survivingBatterName)} Solo)`;
      } else {
        btnSingle.style.display = 'none';
      }
    }

    if (btnAllOut) {
      btnAllOut.style.display = 'block';
      btnAllOut.className = 'btn btn-ghost btn-full';
      btnAllOut.innerHTML = isLastInnings ? '🏆 All Out / View Result' : '🏁 All Out / Start 2nd Innings';
    }
  }

  const customInput = document.getElementById('input-next-batsman-custom');
  if (customInput) customInput.value = '';

  document.getElementById('next-batsman-modal').style.display = 'flex';
};

window.confirmNextBatsman = function () {
  const customName = document.getElementById('input-next-batsman-custom')?.value.trim();
  const selectName = document.getElementById('select-next-batsman')?.value;
  const batsmanName = customName || selectName;

  if (!batsmanName) {
    return toast('⚠️ Please select or enter a player name, or click End Innings');
  }

  socket.emit('score:nextBatsman', {
    inningsIdx: state.room.match.currentInnings,
    batsmanName,
    isSingleBatter: false,
    token: state.session?.token
  }, (res) => {
    if (res && !res.success) {
      toast(`❌ ${res.error || 'Failed to select next batter'}`);
    } else {
      toast(`🏏 ${batsmanName} is on strike!`);
    }
  });

  document.getElementById('next-batsman-modal').style.display = 'none';
};

window.confirmSingleBatter = function () {
  const match = state.room?.match;
  const idx = match?.currentInnings ?? 0;
  const inn = match?.innings?.[idx];
  
  const nonStrikerIdx = inn?.currentBatsmen?.[1];
  const strikerIdx = inn?.currentBatsmen?.[0];
  const hasSurvivingNonStriker = nonStrikerIdx !== null && inn?.batsmen?.[nonStrikerIdx] && !inn.batsmen[nonStrikerIdx].out;
  const hasSurvivingStriker = strikerIdx !== null && inn?.batsmen?.[strikerIdx] && !inn.batsmen[strikerIdx].out;

  if (!hasSurvivingNonStriker && !hasSurvivingStriker) {
    return toast('⚠️ All batters are out! Single batter mode unavailable. Please click End Innings.');
  }

  socket.emit('score:nextBatsman', {
    inningsIdx: idx,
    isSingleBatter: true,
    token: state.session?.token
  }, (res) => {
    if (res && !res.success) {
      toast(`❌ ${res.error || 'Failed to switch to single batter mode'}`);
    } else {
      toast(`👤 Continuing in Single Batter Mode!`);
    }
  });

  document.getElementById('next-batsman-modal').style.display = 'none';
};

window.declareAllOut = function () {
  const nextModal = document.getElementById('next-batsman-modal');
  if (nextModal) nextModal.style.display = 'none';

  const curInnings = state.room?.match?.currentInnings ?? 0;
  const isLastInnings = curInnings === 1 || curInnings === 3 || state.room?.match?.status === 'innings2' || state.room?.match?.status === 'super_over_inn2' || state.room?.match?.status === 'completed';

  socket.emit('score:endInnings', {
    inningsIdx: curInnings,
    token: state.session?.token
  }, (res) => {
    if (res && !res.success) {
      toast(`❌ ${res.error || 'Failed to end innings'}`);
    } else {
      if (isLastInnings) {
        toast('🏆 Match completed! Viewing summary...');
        document.querySelector('.tab[data-tab="summary"]')?.click();
      } else {
        toast('🏁 1st Innings completed! Moving to 2nd Innings...');
      }
    }
  });
};

window.startRematch = function (resetToSetup = false) {
  if (!isHost()) return toast('⚠️ Only the host can start a rematch');
  const msg = resetToSetup 
    ? 'Re-configure teams & overs for the next game in this room?' 
    : 'Start 2nd Match with same teams? This will take you directly to Toss!';
  if (!confirm(msg)) return;

  socket.emit('match:rematch', { resetToSetup }, (res) => {
    if (res && res.success) {
      toast(resetToSetup ? '⚙️ Resetting setup for Next Match...' : '🔄 Next Match started! Moving to Toss...');
      document.querySelector('.tab[data-tab="setup"]')?.click();
    } else {
      toast(`❌ Error: ${res?.error || 'Failed to start rematch'}`);
    }
  });
};

// Bowler Modal
window.openBowlerModal = function (isEndOfOver = false) {
  const match = state.room?.match;
  if (!match) return;
  const idx = match.currentInnings;
  const inn = match.innings[idx];
  let players = getPlayerList(match, inn.bowlingTeam);

  if (players.length === 0) {
    const planningNames = Object.values(state.room?.planning?.members || {}).map(m => m.name?.trim()).filter(Boolean);
    const existingBowlers = (inn.bowlers || []).map(b => b.name?.trim()).filter(Boolean);
    const combined = Array.from(new Set([...planningNames, ...existingBowlers]));
    if (combined.length > 0) players = combined;
  }

  // Build options — disable last bowler when end-of-over
  const lastBowlerName = (isEndOfOver && inn.lastBowlerIdx !== null && inn.bowlers[inn.lastBowlerIdx])
    ? inn.bowlers[inn.lastBowlerIdx].name : null;

  const bowlerSelect = document.getElementById('select-bowler');
  const bowlerCustom = document.getElementById('input-bowler-custom');
  if (bowlerCustom) bowlerCustom.value = '';

  if (players.length > 0) {
    const options = players.map(p => {
      const isLast = p === lastBowlerName;
      return `<option value="${escHtml(p)}" ${isLast ? 'disabled' : ''}>${escHtml(p)}${isLast ? ' (just bowled)' : ''}</option>`;
    }).join('');
    if (bowlerSelect) bowlerSelect.innerHTML = options;
  } else {
    if (bowlerSelect) bowlerSelect.innerHTML = '<option value="">-- Type bowler name below --</option>';
  }

  // If end-of-over: do NOT pre-select anything; force a fresh pick
  if (!isEndOfOver && inn.currentBowler !== null && inn.bowlers[inn.currentBowler]) {
    if (bowlerSelect) bowlerSelect.value = inn.bowlers[inn.currentBowler].name;
  } else if (isEndOfOver) {
    // Select first non-last bowler
    const firstAvail = players.find(p => p !== lastBowlerName);
    if (firstAvail && bowlerSelect) bowlerSelect.value = firstAvail;
  }

  // Update modal heading & sub-text
  const heading = document.getElementById('bowler-modal-title');
  const subtext = document.getElementById('bowler-modal-sub');
  if (heading) heading.textContent = isEndOfOver ? '🔄 End of Over — New Bowler' : '⚾ Set Bowler';
  if (subtext) {
    subtext.style.display = isEndOfOver ? 'block' : 'none';
    if (isEndOfOver) {
      const overNum = inn.ballLog.length;
      subtext.textContent = `Over ${overNum} complete! Strike has changed. Choose a different bowler for Over ${overNum + 1}.`;
    }
  }

  document.getElementById('bowler-modal').style.display = 'flex';
};

document.getElementById('btn-confirm-bowler')?.addEventListener('click', () => {
  const bowlerSel = document.getElementById('select-bowler')?.value?.trim();
  const bowlerCustom = document.getElementById('input-bowler-custom')?.value?.trim();
  const bowler = bowlerCustom || (bowlerSel && bowlerSel !== 'No players' ? bowlerSel : '');
  if (!bowler) return toast('⚠️ Please select or enter a bowler name');
  socket.emit('score:setBowler', {
    inningsIdx: state.room.match.currentInnings,
    bowlerName: bowler,
    token: state.session?.token
  }, (res) => {
    if (res && !res.success) {
      toast(`❌ ${res.error || 'Failed to set bowler'}`);
    } else {
      toast(`⚾ ${bowler} is bowling`);
    }
  });
  document.getElementById('bowler-modal').style.display = 'none';
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
});

// ══════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════
function renderSummary() {
  const { room } = state;
  if (!room) return;
  const match = room.match;
  const panel = document.getElementById('summary-panel');
  if (!panel) return;

  if (match.status !== 'completed') {
    panel.innerHTML = `<div class="empty-state-large"><div class="empty-icon">🏆</div><p>Match summary will appear when the match ends</p></div>`;
    return;
  }

  const inn1 = match.innings[0];
  const inn2 = match.innings[1];
  const bat1 = getTeamName(match, inn1.battingTeam);
  const bat2 = getTeamName(match, inn2?.battingTeam || '');

  let winner = '', winnerDetail = '', trophyIcon = '🏆';
  const res = match.result || (typeof calculateMatchResult === 'function' ? calculateMatchResult(match) : null);

  if (match.isSuperOver && match.innings?.length >= 4) {
    const so1 = match.innings[2];
    const so2 = match.innings[3];
    const so1Name = getTeamName(match, so1?.battingTeam);
    const so2Name = getTeamName(match, so2?.battingTeam);
    if (res?.winner === 'tie' || (so1 && so2 && so1.runs === so2.runs)) {
      winner = '⚡ Super Over Tied';
      winnerDetail = `Scores level in Super Over shootout (${so1.runs} - ${so2.runs})`;
      trophyIcon = '🤝';
    } else if (res?.winnerName || res?.winner) {
      winner = res.winnerName || getTeamName(match, res.winner);
      winnerDetail = res.summary || `${winner} won via Super Over! 🏆`;
      trophyIcon = '⚡';
    } else {
      winner = '⚡ Super Over Shootout';
      winnerDetail = res?.summary || 'Shootout in progress';
      trophyIcon = '⚡';
    }
  } else if (res?.winner === 'tie' || (inn1 && inn2 && inn1.runs === inn2.runs)) {
    winner = 'Match Tied';
    winnerDetail = `Both teams scored ${inn1.runs} run${inn1.runs === 1 ? '' : 's'} (${inn1.runs} - ${inn2 ? inn2.runs : 0})`;
    trophyIcon = '🤝';
  } else if (res?.winnerName || res?.winner) {
    winner = res.winnerName || getTeamName(match, res.winner);
    winnerDetail = res.summary || `${winner} won`;
    trophyIcon = '🏆';
  } else if (inn2 && inn2.target !== null && inn2.runs >= inn2.target) {
    const w = Math.max(1, 10 - inn2.wickets);
    winner = bat2;
    winnerDetail = `${bat2} won by ${w} wicket${w !== 1 ? 's' : ''}`;
    trophyIcon = '🏆';
  } else if (inn1 && inn2 && inn1.runs > inn2.runs) {
    const d = inn1.runs - inn2.runs;
    winner = bat1;
    winnerDetail = `${bat1} won by ${d} run${d !== 1 ? 's' : ''}`;
    trophyIcon = '🏆';
  } else if (inn1 && inn2 && inn2.runs > inn1.runs) {
    const w = Math.max(1, 10 - inn2.wickets);
    winner = bat2;
    winnerDetail = `${bat2} won by ${w} wicket${w !== 1 ? 's' : ''}`;
    trophyIcon = '🏆';
  } else {
    winner = 'Match Completed';
    winnerDetail = res?.summary || 'Match has finished';
    trophyIcon = '🏆';
  }

  const topBat = [...(inn1.batsmen), ...(inn2?.batsmen || [])].sort((a, b) => b.runs - a.runs)[0];
  const topBowl = [...(inn1.bowlers), ...(inn2?.bowlers || [])].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];

  panel.innerHTML = `
    <div class="summary-hero">
      <div class="summary-trophy">${trophyIcon}</div>
      <div class="summary-winner">${escHtml(winner)}</div>
      <div class="summary-detail">${escHtml(winnerDetail)}</div>
      <button class="btn btn-primary" onclick="openPosterExport()" style="margin-top:0.85rem;font-weight:700">
        🎨 Export Match Poster (WhatsApp / Story) 📲
      </button>
    </div>
    <div class="summary-scores">
      <div class="glass-card">
        <div class="sc-section-title">${escHtml(bat1)} (1st Innings)</div>
        <div style="font-family:var(--font-display);font-size:2rem;font-weight:700;color:var(--team1)">${inn1.runs}/${inn1.wickets}</div>
        <div style="color:var(--text-2);font-size:0.85rem">${formatOvers(inn1.balls)} overs</div>
      </div>
      ${inn2 ? `
      <div class="glass-card">
        <div class="sc-section-title">${escHtml(bat2)} (2nd Innings)</div>
        <div style="font-family:var(--font-display);font-size:2rem;font-weight:700;color:var(--team2)">${inn2.runs}/${inn2.wickets}</div>
        <div style="color:var(--text-2);font-size:0.85rem">${formatOvers(inn2.balls)} overs · Target: ${inn2.target}</div>
      </div>` : ''}
    </div>
    ${match.isSuperOver && match.innings.length >= 4 ? `
    <div class="glass-card" style="margin-top:1rem;border:1px solid var(--warning);background:rgba(255,183,77,0.06)">
      <div class="sc-section-title" style="color:var(--warning)">⚡ Super Over Shootout Figures</div>
      <div style="display:flex;justify-content:space-around;margin-top:0.5rem;text-align:center">
        <div>
          <div style="font-size:0.85rem;color:var(--text-2)">${escHtml(getTeamName(match, match.innings[2].battingTeam))}</div>
          <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;color:#fff">${match.innings[2].runs}/${match.innings[2].wickets}</div>
        </div>
        <div style="align-self:center;font-weight:800;color:var(--warning)">VS</div>
        <div>
          <div style="font-size:0.85rem;color:var(--text-2)">${escHtml(getTeamName(match, match.innings[3].battingTeam))}</div>
          <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;color:#fff">${match.innings[3].runs}/${match.innings[3].wickets}</div>
        </div>
      </div>
    </div>` : ''}
    ${topBat ? `
    <div class="glass-card" style="margin-top:1rem">
      <div class="sc-section-title">⭐ Standout Performers</div>
      <div style="font-family:var(--font-display);font-size:1.4rem;font-weight:700;color:var(--warning)">${escHtml(topBat.name)}</div>
      <div style="color:var(--text-2);font-size:0.85rem">Top bat: ${topBat.runs} runs (${topBat.balls} balls · ${topBat.fours} fours · ${topBat.sixes} sixes)</div>
      ${topBowl ? `<div style="color:var(--text-2);font-size:0.85rem;margin-top:0.3rem">Top bowl: ${escHtml(topBowl.name)} — ${topBowl.wickets}/${topBowl.runs}</div>` : ''}
    </div>` : ''}

    <!-- Rematch & Next Match in Same Room Card -->
    <div class="glass-card" style="margin-top:1.25rem;border:1px solid rgba(0,229,255,0.35);background:linear-gradient(135deg, rgba(0,229,255,0.06), rgba(255,107,53,0.06));text-align:center;padding:1.4rem">
      <div style="font-size:1.8rem;margin-bottom:0.25rem">🔄</div>
      <div class="sc-section-title" style="color:var(--accent);font-size:1.1rem;margin-bottom:0.35rem">Start Next Match in Same Room</div>
      <p style="color:var(--text-2);font-size:0.85rem;margin-bottom:1.1rem">
        Keep everyone connected in room <strong style="color:var(--accent)">${escHtml(room.code)}</strong> and launch Match 2!
      </p>
      ${isHost() ? `
      <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-primary" id="btn-start-match-2" onclick="startRematch(false)" style="font-weight:800;padding:0.75rem 1.4rem">
          🔄 Start 2nd Match (New Toss & Same Teams)
        </button>
        <button class="btn btn-secondary" id="btn-reset-match-setup" onclick="startRematch(true)" style="font-weight:700;padding:0.75rem 1.4rem">
          ⚙️ Re-Setup Match (Change Overs / Teams)
        </button>
      </div>` : `
      <div class="status-badge" style="display:inline-block;padding:0.5rem 1rem;background:rgba(255,255,255,0.05);color:var(--text-2);border-radius:20px;font-size:0.85rem">
        ⏳ Waiting for host to launch the next match...
      </div>`}
    </div>
  `;
}

// ══════════════════════════════════════════════
//  SOCKET EVENTS — Match state updates
// ══════════════════════════════════════════════
socket.on('state:update', (room) => {
  const prevRoom = state.room;
  const prevStatus = prevRoom?.match?.status;
  const prevAwait = prevRoom?.match?.innings?.[prevRoom?.match?.currentInnings]?.awaitingNewBowler;
  state.room = room;

  // Auto-navigate non-hosts to lobby when match transitions from planning
  const onPlanningScreen = document.getElementById('screen-planning')?.classList.contains('active');
  if (onPlanningScreen && !isHost()) {
    const s = room.match?.status;
    if (s && s !== 'planning') {
      enterLobby();
    }
  }

  renderAll();
  renderPlanningLocation();
  renderPlanningAnnouncements();
  renderPlanningChat();

  if (room.match.status === 'toss' && prevStatus !== 'toss') {
    if (isHost()) showTossModal();
    else toast('🪙 Toss in progress…');
  }

  if ((room.match.status === 'innings1' || room.match.status === 'innings2' || room.match.status.startsWith('super_over_')) && (prevStatus === 'toss' || prevStatus === 'completed' || prevStatus === 'setup')) {
    if (!isHost() && !document.getElementById('screen-lobby')?.classList.contains('active')) {
      enterLobby();
    }
    document.querySelector('.tab[data-tab="scoring"]')?.click();
    toast(room.match.status.startsWith('super_over_') ? '⚡ Super Over started! Time to score!' : '🏏 Match started! Time to score!');
  }
  if (room.match.status === 'innings2' && prevStatus === 'innings1') {
    const inn = room.match.innings[0];
    toast(`✅ 1st Innings done! ${getTeamName(room.match, inn.battingTeam)}: ${inn.runs}/${inn.wickets}. Target: ${inn.runs + 1}`);
    document.querySelector('.tab[data-tab="scoring"]')?.click();
    const nbModal = document.getElementById('next-batsman-modal');
    if (nbModal) nbModal.style.display = 'none';
    if (isHost()) {
      setTimeout(() => openBatsmenModal(), 400);
    }
  }
  if (room.match.status === 'completed' && prevStatus !== 'completed') {
    document.querySelector('.tab[data-tab="summary"]')?.click();
    toast('🏆 Match complete!');
    const nbModal = document.getElementById('next-batsman-modal');
    if (nbModal) nbModal.style.display = 'none';
    const bModal = document.getElementById('batsmen-modal');
    if (bModal) bModal.style.display = 'none';
    const bowlModal = document.getElementById('bowler-modal');
    if (bowlModal) bowlModal.style.display = 'none';

    // Check if tied match and prompt Super Over shootout
    const inn1 = room.match.innings?.[0];
    const inn2 = room.match.innings?.[1];
    if (inn1 && inn2 && inn1.runs === inn2.runs && !room.match.isSuperOver) {
      const soModal = document.getElementById('super-over-modal');
      const hostActions = document.getElementById('super-over-host-actions');
      const guestMsg = document.getElementById('super-over-guest-msg');
      const scoreSub = document.getElementById('super-over-score-sub');
      if (soModal) {
        if (scoreSub) scoreSub.textContent = `Scores Level: ${inn1.runs} - ${inn2.runs}! Both teams tied!`;
        if (hostActions) hostActions.style.display = isHost() ? 'flex' : 'none';
        if (guestMsg) guestMsg.style.display = isHost() ? 'none' : 'block';
        soModal.style.display = 'flex';
      }
    }
  }

  // ── End-of-over: auto-open new bowler modal (HOST ONLY) ──
  const curIdx = room.match.currentInnings;
  const curInn = room.match.innings[curIdx];
  const nowAwaiting = curInn?.awaitingNewBowler;
  if (nowAwaiting && !prevAwait && !curInn?.completed) {
    document.querySelector('.tab[data-tab="scoring"]')?.click();
    const overDone = curInn.ballLog?.length || 0;
    if (isHost()) {
      toast(`✅ Over ${overDone} complete! Strike changed — pick new bowler.`, 4500);
      setTimeout(() => openBowlerModal(true), 300);
    } else {
      toast(`✅ Over ${overDone} complete! Strike changed.`, 3000);
    }
  }

  // ── Wicket fallen: auto-open next batsman modal (HOST ONLY) ──
  const prevAwaitBat = prevRoom?.match?.innings?.[prevRoom?.match?.currentInnings]?.awaitingNewBatsman;
  const nowAwaitingBat = curInn?.awaitingNewBatsman;
  if (nowAwaitingBat && !prevAwaitBat && !curInn?.completed && room.match.status !== 'completed') {
    document.querySelector('.tab[data-tab="scoring"]')?.click();
    if (isHost()) {
      toast(`💥 Wicket fell! Choose next batter or continue with 1 batter.`, 4500);
      setTimeout(() => openNextBatsmanModal(), 300);
    } else {
      toast(`💥 Wicket fell! Next batter walking out to the crease...`, 3000);
    }
  } else if (!nowAwaitingBat || curInn?.completed || room.match.status === 'completed') {
    const nbModal = document.getElementById('next-batsman-modal');
    if (nbModal) nbModal.style.display = 'none';
  }

  updateTossButton();
});

// ── Server validation error (e.g. consecutive bowler or awaiting batter) ────
socket.on('score:error', ({ message }) => {
  toast('⚠️ ' + message, 5000);
  // Re-open bowler/batsman modal so host can pick
  if (isHost()) {
    const idx = state.room?.match?.currentInnings;
    const inn = state.room?.match?.innings?.[idx];
    if (inn?.awaitingNewBowler) setTimeout(() => openBowlerModal(true), 200);
    if (inn?.awaitingNewBatsman) setTimeout(() => openNextBatsmanModal(), 200);
  }
});

socket.on('room:expired', () => {
  toast('⚠️ Room expired (24h limit). Returning home…');
  setTimeout(() => { state.room = null; showHomeScreen(); }, 3000);
});

socket.on('disconnect', () => toast('⚠️ Disconnected. Reconnecting…'));
socket.on('connect', () => { if (state.session) toast('✅ Reconnected!'); });

// ══════════════════════════════════════════════
//  LOBBY CHAT
// ══════════════════════════════════════════════
document.getElementById('btn-chat-send').addEventListener('click', sendLobbyChat);
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendLobbyChat();
});
function sendLobbyChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat:message', { text });
  input.value = '';
}

// ══════════════════════════════════════════════
//  MATCH HISTORY SCREEN & VIEWER
// ══════════════════════════════════════════════
let historyCache = [];

async function openHistoryScreen() {
  showScreen('screen-history');
  await loadMatchHistory();
}

async function loadMatchHistory() {
  const listEl = document.getElementById('history-list');
  if (!listEl) return;
  listEl.innerHTML = `
    <div class="empty-state-large">
      <div class="empty-icon">⏳</div>
      <p>Loading past matches...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    historyCache = data.matches || [];
    renderHistoryList(historyCache);
  } catch (err) {
    console.error('Failed to load history:', err);
    listEl.innerHTML = `
      <div class="empty-state-large">
        <div class="empty-icon">⚠️</div>
        <p>Could not load match history. Please try again.</p>
      </div>
    `;
  }
}

function renderHistoryList(matches) {
  const listEl = document.getElementById('history-list');
  if (!listEl) return;

  const query = document.getElementById('history-search')?.value.trim().toLowerCase() || '';
  const filtered = query
    ? matches.filter(m => {
      const title = (m.matchName || '').toLowerCase();
      const t1 = (m.teams?.team1?.name || '').toLowerCase();
      const t2 = (m.teams?.team2?.name || '').toLowerCase();
      const loc = (m.location?.text || '').toLowerCase();
      const code = (m.code || '').toLowerCase();
      return title.includes(query) || t1.includes(query) || t2.includes(query) || loc.includes(query) || code.includes(query);
    })
    : matches;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state-large">
        <div class="empty-icon">🏏</div>
        <p>${query ? 'No matches matching your search.' : 'No archived matches yet. Completed or reset matches will appear here.'}</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(m => {
    const d = m.savedAt ? new Date(m.savedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Past Match';
    const t1Name = m.teams?.team1?.name || 'Team 1';
    const t2Name = m.teams?.team2?.name || 'Team 2';
    const inn1 = m.inningsSummary?.[0];
    const inn2 = m.inningsSummary?.[1];

    const t1Score = inn1 && (inn1.balls > 0 || inn1.runs > 0)
      ? `${inn1.runs}/${inn1.wickets} <span class="history-overs-info">(${formatOvers(inn1.balls)} ov)</span>`
      : '—';
    const t2Score = inn2 && (inn2.balls > 0 || inn2.runs > 0)
      ? `${inn2.runs}/${inn2.wickets} <span class="history-overs-info">(${formatOvers(inn2.balls)} ov)</span>`
      : '—';

    const resultSummary = m.result?.summary || (m.status === 'completed' ? 'Match Completed' : 'Match Archived');
    const isCompleted = m.status === 'completed' || !!m.result?.winner;

    return `
      <div class="history-card glass-card">
        <div class="history-card-top">
          <div class="history-match-title">
            <span>🏏</span>
            <strong>${escHtml(m.matchName || 'Cricket Match')}</strong>
            <span class="history-code-badge">${escHtml(m.code || '')}</span>
          </div>
          <div class="history-date-badge">
            <span>📅</span> ${d}
          </div>
        </div>

        <div class="history-card-body">
          <div class="history-team-box team1">
            <div class="history-team-name">${escHtml(t1Name)}</div>
            <div class="history-score-display history-score-t1">${t1Score}</div>
          </div>

          <div class="history-vs-badge">VS</div>

          <div class="history-team-box team2">
            <div class="history-team-name">${escHtml(t2Name)}</div>
            <div class="history-score-display history-score-t2">${t2Score}</div>
          </div>
        </div>

        <div class="history-card-footer">
          <div>
            ${isCompleted
        ? `<span class="history-winner-pill">🏆 ${escHtml(resultSummary)}</span>`
        : `<span class="history-incomplete-pill">⏸️ ${escHtml(resultSummary)}</span>`}
            ${m.location?.text ? `<span style="font-size:0.78rem;color:var(--text-3);margin-left:0.5rem">📍 ${escHtml(m.location.text)}</span>` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" onclick="viewHistoricalMatch('${m.id}')">
            📊 View Full Scorecard
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.viewHistoricalMatch = async function (id) {
  const modal = document.getElementById('history-detail-modal');
  const titleEl = document.getElementById('history-modal-title');
  const subEl = document.getElementById('history-modal-sub');
  const bodyEl = document.getElementById('history-modal-body');

  modal.style.display = 'flex';
  titleEl.textContent = 'Loading match details...';
  subEl.textContent = '';
  bodyEl.innerHTML = `<div class="empty-state-large"><div class="empty-icon">⏳</div><p>Loading scorecard...</p></div>`;

  try {
    const res = await fetch(`/api/history/${id}`);
    if (!res.ok) throw new Error('Match not found');
    const { match } = await res.json();

    titleEl.textContent = match.matchName || 'Cricket Match';
    const dateStr = match.savedAt ? new Date(match.savedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    subEl.innerHTML = `Room: <strong>${escHtml(match.code)}</strong> · ${dateStr} ${match.location?.text ? `· 📍 ${escHtml(match.location.text)}` : ''}`;

    let html = '';

    // Result banner
    const resultSummary = match.result?.summary || (match.status === 'completed' ? 'Match Completed' : 'Archived Match');
    html += `
      <div class="summary-hero" style="margin-bottom:1rem">
        <div class="summary-trophy">🏆</div>
        <div class="summary-winner">${escHtml(resultSummary)}</div>
        ${match.toss ? `<div class="summary-detail">Toss: ${escHtml(match.teams[match.toss.winner]?.name || match.toss.winner)} chose to ${match.toss.choice}</div>` : ''}
        <button class="btn btn-primary btn-sm" id="btn-hist-export-poster" style="margin-top:0.75rem;font-weight:700">
          🎨 Export Match Poster 📲
        </button>
      </div>
    `;

    // Scorecards for each innings
    (match.innings || []).forEach((inn, idx) => {
      if (!inn.battingTeam && (!inn.batsmen || inn.batsmen.length === 0) && inn.runs === 0) return;
      const teamName = getTeamName(match, inn.battingTeam || (idx === 0 ? 'team1' : 'team2'));
      const bowlTeamName = getTeamName(match, inn.bowlingTeam || (idx === 0 ? 'team2' : 'team1'));
      html += buildScorecardInnings(match, inn, idx, teamName, bowlTeamName, false);
    });

    bodyEl.innerHTML = html || `<div class="empty-state-large"><div class="empty-icon">📊</div><p>No ball-by-ball details recorded for this match.</p></div>`;
    document.getElementById('btn-hist-export-poster')?.addEventListener('click', () => {
      openPosterExport(match);
    });
  } catch (err) {
    console.error('Error opening historical match:', err);
    bodyEl.innerHTML = `<div class="empty-state-large"><div class="empty-icon">⚠️</div><p>Failed to load match scorecard details.</p></div>`;
  }
};

function navigateBackFromHistory() {
  if (state.room) {
    if (state.room.match && state.room.match.status !== 'planning') {
      showScreen('screen-lobby');
    } else {
      showScreen('screen-planning');
    }
  } else {
    showHomeScreen();
  }
}

document.getElementById('btn-history-back')?.addEventListener('click', navigateBackFromHistory);
document.getElementById('btn-refresh-history')?.addEventListener('click', loadMatchHistory);
document.getElementById('history-search')?.addEventListener('input', () => renderHistoryList(historyCache));
document.getElementById('btn-close-history-modal')?.addEventListener('click', () => {
  document.getElementById('history-detail-modal').style.display = 'none';
});
document.getElementById('history-detail-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'history-detail-modal') {
    document.getElementById('history-detail-modal').style.display = 'none';
  }
});

// ══════════════════════════════════════════════
//  PLAYER PROFILE & DIRECTORY
// ══════════════════════════════════════════════

window.switchProfileTab = function (tab) {
  const tabStatsBtn = document.getElementById('prof-tab-stats');
  const tabMatchesBtn = document.getElementById('prof-tab-matches');
  const paneStats = document.getElementById('prof-pane-stats');
  const paneMatches = document.getElementById('prof-pane-matches');

  if (!tabStatsBtn || !paneStats) return;

  if (tab === 'stats') {
    tabStatsBtn.classList.add('active');
    tabMatchesBtn.classList.remove('active');
    paneStats.style.display = 'block';
    paneMatches.style.display = 'none';
  } else {
    tabStatsBtn.classList.remove('active');
    tabMatchesBtn.classList.add('active');
    paneStats.style.display = 'none';
    paneMatches.style.display = 'block';
  }
};

window.openPlayerProfile = async function (identifier) {
  if (!identifier) {
    identifier = state.session?.user?.phone || state.session?.user?.name;
  }
  if (!identifier) return;

  const modal = document.getElementById('player-profile-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  switchProfileTab('stats');

  document.getElementById('prof-name').textContent = 'Loading...';
  document.getElementById('prof-avatar').textContent = '🏏';
  document.getElementById('prof-avatar').style.background = 'var(--primary)';
  document.getElementById('prof-phone').textContent = '📱 Loading...';
  document.getElementById('prof-joined').textContent = '';

  try {
    const headers = {};
    if (state.session?.token) {
      headers['Authorization'] = `Bearer ${state.session.token}`;
    }
    const res = await fetch(`/api/profile/${encodeURIComponent(identifier)}`, { headers });
    if (!res.ok) throw new Error('Player profile not found');
    const data = await res.json();
    renderPlayerProfileData(data);
  } catch (err) {
    console.error('Error fetching player profile:', err);
    showToast('Could not load player profile', 'error');
    document.getElementById('prof-name').textContent = 'Player Profile';
    document.getElementById('prof-phone').textContent = 'No match records yet';
  }
};

function renderPlayerProfileData(data) {
  const user = data.user || data.player || {};
  const stats = data.stats || {};
  const matchesByDate = data.matchesByDate || [];
  const bat = stats.batting || {};
  const bowl = stats.bowling || {};
  const isMe = !!(data.isMe || (state.session?.user?.phone && (state.session.user.phone === user.phone || state.session.user.phone === user.rawPhone)));

  // Header info
  document.getElementById('prof-name').textContent = user.name || 'Player';

  const avatarEl = document.getElementById('prof-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = getAvatarHtml(user.avatar, user.name, user.color, 70);
    avatarEl.style.background = getAvatarBg(user.avatar, user.color);
    avatarEl.style.overflow = 'hidden';
  }

  const phoneEl = document.getElementById('prof-phone');
  if (isMe) {
    phoneEl.innerHTML = `📱 ${escHtml(user.phone || state.session?.user?.phone || '')} <span style="font-size:0.75rem;padding:0.15rem 0.45rem;border-radius:6px;background:rgba(0,230,118,0.15);color:var(--success);font-weight:600;margin-left:0.3rem">🔒 Private to You</span>`;
  } else {
    phoneEl.textContent = user.phone ? `📱 ${user.phone}` : '📱 🛡️ Verified Cricketer';
  }

  const memberSinceStr = user.memberSince || (user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '4 Sep 2026');
  document.getElementById('prof-joined').innerHTML = `🗓️ <strong>Joined:</strong> ${escHtml(memberSinceStr)}`;

  document.getElementById('prof-badge').textContent = isMe ? 'YOU' : 'PLAYER';
  document.getElementById('prof-badge').style.background = isMe ? 'rgba(76, 175, 80, 0.2)' : 'rgba(0, 229, 255, 0.15)';
  document.getElementById('prof-badge').style.color = isMe ? 'var(--success)' : 'var(--primary)';

  // Privacy note & Footer logout actions
  const privacyNoteEl = document.getElementById('prof-privacy-note');
  if (privacyNoteEl) {
    privacyNoteEl.textContent = isMe
      ? '🛡️ Your phone number is masked for other players to protect your account privacy.'
      : '🛡️ Sensitive player contact numbers are securely masked.';
  }

  const footerActions = document.getElementById('prof-footer-actions');
  if (footerActions) {
    footerActions.style.display = isMe ? 'flex' : 'none';
  }

  // Avatar edit controls (Only visible for logged-in user's own profile)
  const editBadge = document.getElementById('btn-edit-avatar');
  const avatarActions = document.getElementById('prof-avatar-actions');
  const removeBtn = document.getElementById('btn-remove-photo');

  if (editBadge) editBadge.style.display = isMe ? 'flex' : 'none';
  if (avatarActions) avatarActions.style.display = isMe ? 'flex' : 'none';
  if (removeBtn) removeBtn.style.display = (isMe && user.avatar) ? 'inline-flex' : 'none';

  // Summary Top Cards
  document.getElementById('prof-total-matches').textContent = user.totalMatches || stats.totalMatches || 0;
  document.getElementById('prof-total-runs').textContent = bat.runs || 0;
  document.getElementById('prof-total-wickets').textContent = bowl.wickets || 0;
  document.getElementById('prof-high-score').textContent = bat.highestScore || bat.highScoreFormatted || (bat.highScore ? String(bat.highScore) : '0');

  // Batting Grid
  document.getElementById('prof-bat-innings').textContent = bat.innings || 0;
  document.getElementById('prof-bat-runs').textContent = bat.runs || 0;
  document.getElementById('prof-bat-balls').textContent = bat.balls || 0;
  document.getElementById('prof-bat-hs').textContent = bat.highestScore || bat.highScoreFormatted || (bat.highScore ? String(bat.highScore) : '0');
  document.getElementById('prof-bat-avg').textContent = bat.average || '0.00';
  document.getElementById('prof-bat-sr').textContent = bat.strikeRate || '0.00';
  document.getElementById('prof-bat-fours').textContent = bat.fours || 0;
  document.getElementById('prof-bat-sixes').textContent = bat.sixes || 0;
  document.getElementById('prof-bat-fifties').textContent = bat.fifties || 0;
  document.getElementById('prof-bat-hundreds').textContent = bat.hundreds || 0;
  document.getElementById('prof-bat-notouts').textContent = bat.notOuts || 0;
  document.getElementById('prof-bat-ducks').textContent = bat.ducks || 0;

  // Bowling Grid
  document.getElementById('prof-bowl-innings').textContent = bowl.innings || 0;
  document.getElementById('prof-bowl-overs').textContent = bowl.overs || bowl.oversFormatted || '0.0';
  document.getElementById('prof-bowl-maidens').textContent = bowl.maidens || 0;
  document.getElementById('prof-bowl-runs').textContent = bowl.runsConceded || bowl.runs || 0;
  document.getElementById('prof-bowl-wickets').textContent = bowl.wickets || 0;
  document.getElementById('prof-bowl-bbi').textContent = bowl.bestBowling || '—';
  document.getElementById('prof-bowl-econ').textContent = bowl.economy || '0.00';
  document.getElementById('prof-bowl-avg').textContent = bowl.average || '0.00';
  document.getElementById('prof-bowl-sr').textContent = bowl.strikeRate || '0.00';
  document.getElementById('prof-bowl-3w').textContent = bowl.threeWickets || 0;
  document.getElementById('prof-bowl-5w').textContent = bowl.fiveWickets || 0;
  document.getElementById('prof-bowl-dots').textContent = bowl.dots || 0;

  // Render Day-by-Day Match Scorecard Feed
  const totalMatchesCount = matchesByDate.reduce((acc, d) => acc + (d.matches?.length || 0), 0);
  document.getElementById('prof-match-count-badge').textContent = totalMatchesCount;

  const matchesListEl = document.getElementById('prof-matches-list');
  if (!matchesByDate || matchesByDate.length === 0) {
    matchesListEl.innerHTML = `<div class="empty-state-large"><div class="empty-icon">🏏</div><p>No matches recorded yet for this player.</p></div>`;
    return;
  }

  let feedHtml = '';
  matchesByDate.forEach(day => {
    feedHtml += `
      <div class="prof-day-group">
        <div class="prof-day-header">
          <span>🗓️ ${escHtml(day.dateHeading || day.dateFormatted || day.dateKey || 'Match Day')}</span>
          <span class="prof-day-badge">${day.matches.length} match${day.matches.length !== 1 ? 'es' : ''}</span>
        </div>
    `;

    day.matches.forEach(m => {
      const isCompleted = m.status === 'completed';
      const statusCls = isCompleted ? 'completed' : 'live';
      const statusText = isCompleted ? 'Completed' : 'Active';
      const batP = m.batting || m.personalBatting;
      const bowlP = m.bowling || m.personalBowling;
      const matchId = m.matchId || m.id;
      const t1 = m.teams?.team1?.name || m.team1Name || 'Team 1';
      const t2 = m.teams?.team2?.name || m.team2Name || 'Team 2';
      const resSum = m.result?.summary || m.resultSummary || '';
      const loc = m.location?.text || m.locationText || '';

      feedHtml += `
        <div class="prof-match-card">
          <div class="prof-match-top">
            <div>
              <div class="prof-match-name">${escHtml(m.matchName || 'Cricket Match')}</div>
              <div class="prof-match-teams">⚔️ ${escHtml(t1)} vs ${escHtml(t2)} ${m.time ? `· ⏰ ${escHtml(m.time)}` : ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <span class="prof-match-status-badge ${statusCls}">${statusText}</span>
              ${matchId ? `<button class="btn btn-ghost btn-sm" onclick="viewHistoricalMatch('${matchId}')" title="View Full Match Scorecard">📊 Scorecard</button>` : ''}
            </div>
          </div>

          <div style="font-size:0.8rem;color:var(--text-2)">
            ${resSum ? `🏆 <strong>Result:</strong> ${escHtml(resSum)}` : ''}
            ${loc ? ` · 📍 ${escHtml(loc)}` : ''}
          </div>

          <div class="prof-perf-grid">
            <!-- Batting Performance -->
            <div class="prof-perf-box batting">
              <div class="prof-perf-title">
                <span>🏏 Batting</span>
                ${batP && batP.didBat ? (batP.out ? '<span style="color:var(--text-3)">Out</span>' : '<span style="color:var(--success)">Not Out*</span>') : ''}
              </div>
              ${batP && batP.didBat ? `
                <div class="prof-perf-score">${batP.runs} <span style="font-size:0.85rem;font-weight:400;color:var(--text-2)">(${batP.balls} balls)</span></div>
                <div class="prof-perf-detail">4s: <strong>${batP.fours}</strong> · 6s: <strong>${batP.sixes}</strong> · SR: <strong>${batP.strikeRate}</strong></div>
                ${batP.dismissal ? `<div class="prof-perf-dismissal">${escHtml(batP.dismissal)}</div>` : ''}
              ` : `
                <div style="font-size:0.82rem;color:var(--text-3);padding:0.3rem 0">Did not bat in this match</div>
              `}
            </div>

            <!-- Bowling Performance -->
            <div class="prof-perf-box bowling">
              <div class="prof-perf-title">
                <span>⚾ Bowling</span>
                ${bowlP && bowlP.didBowl ? `<span style="color:var(--secondary)">${bowlP.oversFormatted || bowlP.overs} ov</span>` : ''}
              </div>
              ${bowlP && bowlP.didBowl ? `
                <div class="prof-perf-score">${bowlP.wickets}/${bowlP.runs} <span style="font-size:0.85rem;font-weight:400;color:var(--text-2)">(${bowlP.oversFormatted || bowlP.overs} ov)</span></div>
                <div class="prof-perf-detail">Econ: <strong>${bowlP.economy}</strong> · Maidens: <strong>${bowlP.maidens}</strong></div>
              ` : `
                <div style="font-size:0.82rem;color:var(--text-3);padding:0.3rem 0">Did not bowl in this match</div>
              `}
            </div>
          </div>
        </div>
      `;
    });

    feedHtml += `</div>`;
  });

  matchesListEl.innerHTML = feedHtml;
}

window.openPlayersDirectory = async function () {
  const modal = document.getElementById('players-directory-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const listEl = document.getElementById('players-dir-list');
  const searchInput = document.getElementById('players-dir-search');
  if (searchInput) searchInput.value = '';

  listEl.innerHTML = `<div class="empty-state-large"><div class="empty-icon">👥</div><p>Loading players...</p></div>`;

  try {
    const res = await fetch('/api/players');
    if (!res.ok) throw new Error('Failed to fetch players');
    const { players } = await res.json();
    playersCache = players || [];
    renderPlayersDirectoryList(playersCache);
  } catch (err) {
    console.error('Error fetching players directory:', err);
    listEl.innerHTML = `<div class="empty-state-large"><div class="empty-icon">⚠️</div><p>Could not load players.</p></div>`;
  }
};

function renderPlayersDirectoryList(players) {
  const listEl = document.getElementById('players-dir-list');
  if (!listEl) return;
  const searchVal = (document.getElementById('players-dir-search')?.value || '').trim().toLowerCase();

  const filtered = (players || []).filter(p => {
    if (!searchVal) return true;
    return (p.name || '').toLowerCase().includes(searchVal) || (p.phone || '').includes(searchVal) || (p.phoneMasked || '').includes(searchVal);
  });

  if (filtered.length === 0) {
    if (!searchVal) {
      listEl.innerHTML = `
        <div class="empty-state-large">
          <div class="empty-icon">🏏</div>
          <p style="font-weight:700;font-size:1rem;color:var(--text-1);margin-bottom:0.3rem">No players registered yet</p>
          <p style="font-size:0.82rem;color:var(--text-2)">Create a profile or start a match to see players here!</p>
        </div>`;
    } else {
      listEl.innerHTML = `<div class="empty-state-large"><div class="empty-icon">🔍</div><p>No players match "${escHtml(searchVal)}"</p></div>`;
    }
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    const isMe = state.session?.user?.phone === p.phone || state.session?.user?.name?.toLowerCase() === (p.name || '').toLowerCase();
    const avatarHtml = getAvatarHtml(p.avatar, p.name, p.color, 36);
    const avatarBg = getAvatarBg(p.avatar, p.color);
    const phoneDisplay = isMe ? (p.phone || p.phoneMasked || 'Your Account') : (p.phoneMasked || '🛡️ Masked for Privacy');

    return `
      <div class="player-dir-item" onclick="document.getElementById('players-directory-modal').style.display='none'; openPlayerProfile('${escHtml(p.phone || p.name)}')">
        <div class="player-dir-left">
          <div class="player-dir-avatar" style="background:${avatarBg};overflow:hidden">${avatarHtml}</div>
          <div class="player-dir-info">
            <div class="player-dir-name">${escHtml(p.name)} ${isMe ? '<span style="color:var(--primary);font-size:0.75rem;font-weight:700">(You)</span>' : ''}</div>
            <div class="player-dir-phone" style="display:flex;align-items:center;gap:0.3rem">
              <span>📱</span>
              <span>${escHtml(phoneDisplay)}</span>
              ${!isMe ? '<span style="font-size:0.68rem;opacity:0.75" title="Privacy Protected">🛡️</span>' : ''}
            </div>
          </div>
        </div>
        <div class="player-dir-stats">
          <div class="player-dir-stat-pill">
            <span class="num">${p.matches || 0}</span>
            <span class="lbl">Matches</span>
          </div>
          <div class="player-dir-stat-pill">
            <span class="num team1-score">${p.runs || 0}</span>
            <span class="lbl">Runs</span>
          </div>
          <div class="player-dir-stat-pill">
            <span class="num team2-score">${p.wickets || 0}</span>
            <span class="lbl">Wkts</span>
          </div>
          <button class="btn btn-ghost btn-sm" style="padding:0.35rem 0.65rem">View 👤</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateAllUserBadges() {
  const user = state.session?.user;
  if (!user) return;

  const planBadge = document.getElementById('planning-user-badge');
  if (planBadge) {
    planBadge.innerHTML = getAvatarHtml(user.avatar, user.name, user.color, 32);
    planBadge.style.background = getAvatarBg(user.avatar, user.color);
    planBadge.style.overflow = 'hidden';
    planBadge.style.padding = '0';
  }

  const lobbyBadge = document.getElementById('user-badge');
  if (lobbyBadge) {
    lobbyBadge.innerHTML = getAvatarHtml(user.avatar, user.name, user.color, 32);
    lobbyBadge.style.background = getAvatarBg(user.avatar, user.color);
    lobbyBadge.style.overflow = 'hidden';
    lobbyBadge.style.padding = '0';
  }

  const homeInfo = document.getElementById('home-user-info');
  if (homeInfo) {
    const avatarHtml = getAvatarHtml(user.avatar, user.name, user.color, 24);
    const avatarBg = getAvatarBg(user.avatar, user.color);
    homeInfo.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:24px;height:24px;border-radius:50%;background:${avatarBg};overflow:hidden;display:inline-flex;align-items:center;justify-content:center">
          ${avatarHtml}
        </div>
        <span style="color:${user.color || 'var(--primary)'};font-weight:700">${escHtml(user.name)}</span>
      </div>
    `;
  }
}

// ── Profile Photo Upload, Camera Stream & Badges ──
let activeCameraStream = null;
let currentFacingMode = 'user';

function setupAvatarUploadHandlers() {
  const pickerModal = document.getElementById('photo-picker-modal');
  const cameraModal = document.getElementById('camera-capture-modal');
  const cameraVideo = document.getElementById('camera-video');

  const editBadge = document.getElementById('btn-edit-avatar');
  const triggerBtn = document.getElementById('btn-trigger-upload-photo');
  const removeBtn = document.getElementById('btn-remove-photo');

  const btnActionCamera = document.getElementById('btn-action-open-camera');
  const btnActionGallery = document.getElementById('btn-action-open-gallery');
  const btnClosePicker = document.getElementById('btn-close-photo-picker');

  const btnSnapPhoto = document.getElementById('btn-snap-photo');
  const btnFlipCamera = document.getElementById('btn-flip-camera');
  const btnCloseCamera = document.getElementById('btn-close-camera-modal');
  const btnCancelCamera = document.getElementById('btn-cancel-camera');

  const cameraNativeInput = document.getElementById('camera-native-input');
  const galleryNativeInput = document.getElementById('gallery-native-input');
  const fileInput = document.getElementById('avatar-file-input');

  function openPhotoChoicePicker() {
    if (pickerModal) pickerModal.style.display = 'flex';
  }

  function closePhotoChoicePicker() {
    if (pickerModal) pickerModal.style.display = 'none';
  }

  editBadge?.addEventListener('click', openPhotoChoicePicker);
  triggerBtn?.addEventListener('click', openPhotoChoicePicker);
  btnClosePicker?.addEventListener('click', closePhotoChoicePicker);
  pickerModal?.addEventListener('click', (e) => {
    if (e.target.id === 'photo-picker-modal') closePhotoChoicePicker();
  });

  // Action 1: Open Live Camera
  btnActionCamera?.addEventListener('click', async () => {
    closePhotoChoicePicker();
    await startCameraStream('user');
  });

  // Action 2: Open Gallery
  btnActionGallery?.addEventListener('click', () => {
    closePhotoChoicePicker();
    galleryNativeInput?.click();
  });

  async function startCameraStream(facingMode = 'user') {
    currentFacingMode = facingMode;
    stopCameraStream();

    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('📷 Opening camera...');
      cameraNativeInput?.click();
      return;
    }

    try {
      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 640 },
          height: { ideal: 640 }
        },
        audio: false
      };

      activeCameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (cameraVideo) {
        cameraVideo.srcObject = activeCameraStream;
        cameraVideo.style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'none';
        cameraVideo.play();
      }

      if (cameraModal) cameraModal.style.display = 'flex';

      // Check if multiple cameras available for flip button
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (btnFlipCamera) {
          btnFlipCamera.style.display = videoDevices.length > 1 ? 'inline-flex' : 'none';
        }
      } catch (e) {
        if (btnFlipCamera) btnFlipCamera.style.display = 'none';
      }
    } catch (err) {
      console.warn('getUserMedia failed or denied, falling back to native camera:', err);
      toast('📷 Opening device camera...');
      cameraNativeInput?.click();
    }
  }

  function stopCameraStream() {
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach(track => track.stop());
      activeCameraStream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
    if (cameraModal) cameraModal.style.display = 'none';
  }

  btnCloseCamera?.addEventListener('click', stopCameraStream);
  btnCancelCamera?.addEventListener('click', stopCameraStream);
  cameraModal?.addEventListener('click', (e) => {
    if (e.target.id === 'camera-capture-modal') stopCameraStream();
  });

  btnFlipCamera?.addEventListener('click', async () => {
    const nextMode = currentFacingMode === 'user' ? 'environment' : 'user';
    await startCameraStream(nextMode);
  });

  // Snap photo from live video feed
  btnSnapPhoto?.addEventListener('click', async () => {
    if (!cameraVideo || !activeCameraStream) return;

    try {
      toast('📸 Capturing photo...');
      const videoWidth = cameraVideo.videoWidth || 480;
      const videoHeight = cameraVideo.videoHeight || 480;

      const canvas = document.createElement('canvas');
      const minDim = Math.min(videoWidth, videoHeight);
      const targetDim = Math.min(240, minDim);
      canvas.width = targetDim;
      canvas.height = targetDim;

      const ctx = canvas.getContext('2d');
      const startX = (videoWidth - minDim) / 2;
      const startY = (videoHeight - minDim) / 2;

      // Handle mirror if front selfie camera
      if (currentFacingMode === 'user') {
        ctx.translate(targetDim, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(cameraVideo, startX, startY, minDim, minDim, 0, 0, targetDim, targetDim);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

      stopCameraStream();
      await uploadProfileAvatarData(dataUrl);
    } catch (err) {
      console.error('Error capturing snapshot:', err);
      toast('❌ Failed to capture photo');
      stopCameraStream();
    }
  });

  // Handle native file inputs
  async function handleFileInput(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('❌ Please select an image file');
      return;
    }

    try {
      toast('📸 Optimizing and uploading photo...');
      const dataUrl = await compressImageToDataUrl(file, 240, 240, 0.85);
      await uploadProfileAvatarData(dataUrl);
    } catch (err) {
      console.error('Error processing photo:', err);
      toast('❌ Failed to upload photo');
    }
  }

  cameraNativeInput?.addEventListener('change', (e) => {
    handleFileInput(e.target.files?.[0]);
    e.target.value = '';
  });

  galleryNativeInput?.addEventListener('change', (e) => {
    handleFileInput(e.target.files?.[0]);
    e.target.value = '';
  });

  fileInput?.addEventListener('change', (e) => {
    handleFileInput(e.target.files?.[0]);
    e.target.value = '';
  });

  async function uploadProfileAvatarData(dataUrl) {
    const phone = state.session?.user?.phone;
    if (!phone) throw new Error('Not logged in');

    const headers = { 'Content-Type': 'application/json' };
    if (state.session?.token) {
      headers['Authorization'] = `Bearer ${state.session.token}`;
    }

    const res = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone, avatar: dataUrl })
    });

    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to update photo');

    if (state.session?.user) {
      state.session.user.avatar = dataUrl;
      saveSession(state.session);
    }

    openPlayerProfile(phone);
    updateAllUserBadges();
    toast('✅ Profile picture updated successfully!');
  }

  removeBtn?.addEventListener('click', async () => {
    const phone = state.session?.user?.phone;
    if (!phone) return;

    try {
      toast('Removing profile photo...');
      const headers = { 'Content-Type': 'application/json' };
      if (state.session?.token) {
        headers['Authorization'] = `Bearer ${state.session.token}`;
      }

      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone, avatar: null })
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to remove photo');

      if (state.session?.user) {
        state.session.user.avatar = null;
        saveSession(state.session);
      }

      openPlayerProfile(phone);
      updateAllUserBadges();
      toast('Profile photo removed');
    } catch (err) {
      console.error('Error removing avatar:', err);
      toast('❌ Failed to remove photo');
    }
  });
}

function compressImageToDataUrl(file, maxWidth, maxHeight, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Crop to square from center
        const minDim = Math.min(width, height);
        const startX = (width - minDim) / 2;
        const startY = (height - minDim) / 2;

        const targetDim = Math.min(maxWidth, minDim);
        canvas.width = targetDim;
        canvas.height = targetDim;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, targetDim, targetDim);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = readerEvent.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Profile & Directory Event Listeners ──
document.getElementById('btn-open-my-profile-home')?.addEventListener('click', () => openPlayerProfile());
document.getElementById('btn-open-players-dir-home')?.addEventListener('click', () => openPlayersDirectory());
document.getElementById('btn-home-players-dir')?.addEventListener('click', () => openPlayersDirectory());
document.getElementById('btn-planning-players-dir')?.addEventListener('click', () => openPlayersDirectory());
document.getElementById('btn-lobby-players-dir')?.addEventListener('click', () => openPlayersDirectory());

document.getElementById('home-user-info')?.addEventListener('click', () => openPlayerProfile());
document.getElementById('planning-user-badge')?.addEventListener('click', () => openPlayerProfile());
document.getElementById('user-badge')?.addEventListener('click', () => openPlayerProfile());

document.getElementById('prof-tab-stats')?.addEventListener('click', () => switchProfileTab('stats'));
document.getElementById('prof-tab-matches')?.addEventListener('click', () => switchProfileTab('matches'));

document.getElementById('btn-close-profile-modal')?.addEventListener('click', () => {
  document.getElementById('player-profile-modal').style.display = 'none';
});
document.getElementById('player-profile-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'player-profile-modal') {
    document.getElementById('player-profile-modal').style.display = 'none';
  }
});

document.getElementById('btn-close-players-dir-modal')?.addEventListener('click', () => {
  document.getElementById('players-directory-modal').style.display = 'none';
});
document.getElementById('players-directory-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'players-directory-modal') {
    document.getElementById('players-directory-modal').style.display = 'none';
  }
});
document.getElementById('players-dir-search')?.addEventListener('input', () => {
  renderPlayersDirectoryList(playersCache);
});

setupAvatarUploadHandlers();

// ══════════════════════════════════════════════
//  PROGRESSIVE WEB APP (PWA) & OFFLINE SYNC
// ══════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.log('✅ Service Worker registered with scope:', reg.scope);
    }).catch((err) => {
      console.warn('Service worker registration warning:', err);
    });
  });
}

window.addEventListener('offline', () => {
  const bar = document.getElementById('offline-bar');
  if (bar) bar.style.display = 'block';
  toast('📶 Network offline — Local scoring active');
});

window.addEventListener('online', () => {
  const bar = document.getElementById('offline-bar');
  if (bar) bar.style.display = 'none';
  toast('✅ Back online! Re-syncing match state...');
  registerSocketUser();
  if (state.room?.code) {
    socket.emit('room:join', { token: state.session?.token, code: state.room.code }, (res) => {
      if (res?.success) state.room = res.room;
      renderAll();
    });
  }
});

// ══════════════════════════════════════════════
//  SUPER OVER EVENT LISTENERS
// ══════════════════════════════════════════════
document.getElementById('btn-start-super-over')?.addEventListener('click', () => {
  socket.emit('match:startSuperOver');
  document.getElementById('super-over-modal').style.display = 'none';
  toast('🚀 Launching Super Over Shootout! Winner takes all!');
});

document.getElementById('btn-decline-super-over')?.addEventListener('click', () => {
  document.getElementById('super-over-modal').style.display = 'none';
  toast('Match concluded as a Tie.');
});

// ══════════════════════════════════════════════
//  SCORECARD POSTER GRAPHIC GENERATOR (CANVAS)
// ══════════════════════════════════════════════
let currentPosterMatch = null;

window.openPosterExport = function (matchData = null) {
  const match = matchData || state.room?.match;
  if (!match) {
    toast('No match data available to export');
    return;
  }
  currentPosterMatch = match;
  const modal = document.getElementById('poster-modal');
  if (modal) modal.style.display = 'flex';
  generateScorecardPoster(match);
};

function generateScorecardPoster(match) {
  const canvas = document.getElementById('poster-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;

  // 1. Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#060a12');
  bg.addColorStop(0.5, '#0a1526');
  bg.addColorStop(1, '#05080e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle decorative glow orbs
  const rad1 = ctx.createRadialGradient(200, 150, 20, 200, 150, 450);
  rad1.addColorStop(0, 'rgba(0, 229, 255, 0.18)');
  rad1.addColorStop(1, 'rgba(0, 229, 255, 0)');
  ctx.fillStyle = rad1;
  ctx.fillRect(0, 0, W, H);

  const rad2 = ctx.createRadialGradient(880, 1000, 20, 880, 1000, 500);
  rad2.addColorStop(0, 'rgba(255, 107, 53, 0.15)');
  rad2.addColorStop(1, 'rgba(255, 107, 53, 0)');
  ctx.fillStyle = rad2;
  ctx.fillRect(0, 0, W, H);

  // Border frame
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  // Inner thin border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(42, 42, W - 84, H - 84);

  // 2. Header Badge
  ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
  roundRect(ctx, W / 2 - 180, 65, 360, 44, 22, true, false);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 1.5;
  roundRect(ctx, W / 2 - 180, 65, 360, 44, 22, false, true);

  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 20px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('🏏 CRICKETHUB MATCH CARD', W / 2, 94);

  // 3. Match Name
  const matchName = (match.matchName || state.room?.matchName || 'Cricket Derby').toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 46px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(matchName.slice(0, 28), W / 2, 175);

  // Date & Venue
  const dateStr = match.date ? `📅 ${match.date} ${match.time ? '• ' + match.time : ''}` : '📅 ' + new Date().toLocaleDateString();
  const venueStr = match.location?.text ? `📍 ${match.location.text.slice(0, 24)}` : '📍 Local Turf';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 24px "Inter", sans-serif';
  ctx.fillText(`${dateStr}   •   ${venueStr}`, W / 2, 218);

  // 4. Result Hero Banner
  const result = match.result?.summary || (match.status === 'completed' ? 'Match Completed' : 'Match In Progress');
  const resY = 260;
  const resH = 95;
  const resGrad = ctx.createLinearGradient(70, resY, W - 70, resY);
  resGrad.addColorStop(0, 'rgba(255, 183, 77, 0.2)');
  resGrad.addColorStop(0.5, 'rgba(255, 183, 77, 0.35)');
  resGrad.addColorStop(1, 'rgba(255, 183, 77, 0.2)');
  ctx.fillStyle = resGrad;
  roundRect(ctx, 70, resY, W - 140, resH, 16, true, false);
  ctx.strokeStyle = 'rgba(255, 183, 77, 0.6)';
  ctx.lineWidth = 2;
  roundRect(ctx, 70, resY, W - 140, resH, 16, false, true);

  ctx.fillStyle = '#ffb74d';
  ctx.font = 'bold 34px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`🏆 ${result}`, W / 2, resY + 58);

  // 5. Team Score Cards
  const inn1 = match.innings?.[0] || { runs: 0, wickets: 0, balls: 0, batsmen: [], bowlers: [] };
  const inn2 = match.innings?.[1] || { runs: 0, wickets: 0, balls: 0, batsmen: [], bowlers: [] };
  const team1Name = getTeamName(match, inn1.battingTeam || 'team1');
  const team2Name = getTeamName(match, inn2.battingTeam || (inn1.battingTeam === 'team1' ? 'team2' : 'team1'));

  // Team 1 Card (Left/Top)
  drawTeamCard(ctx, 70, 385, 455, 230, team1Name, inn1, '#00e5ff', '1ST INNINGS');
  // Team 2 Card (Right/Top)
  drawTeamCard(ctx, 555, 385, 455, 230, team2Name, inn2, '#ff6b35', inn2.target ? `TARGET: ${inn2.target}` : '2ND INNINGS');

  // 6. Top Performers Cards
  const allBatsmen = [...(inn1.batsmen || []), ...(inn2.batsmen || [])];
  const allBowlers = [...(inn1.bowlers || []), ...(inn2.bowlers || [])];
  const topBat = allBatsmen.sort((a, b) => b.runs - a.runs)[0];
  const topBowl = allBowlers.sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];

  drawPerformerCard(ctx, 70, 645, 455, 260, '🏏 TOP BATTER', topBat ? topBat.name : '—', topBat ? `${topBat.runs} Runs (${topBat.balls}b)` : 'No runs logged', topBat ? `${topBat.fours}x4s • ${topBat.sixes}x6s • SR: ${topBat.balls > 0 ? ((topBat.runs / topBat.balls) * 100).toFixed(0) : '0'}` : '—', '#00e5ff');

  drawPerformerCard(ctx, 555, 645, 455, 260, '⚾ TOP BOWLER', topBowl ? topBowl.name : '—', topBowl ? `${topBowl.wickets}/${topBowl.runs} (${Math.floor((topBowl.overs || 0))} ov)` : 'No wickets', topBowl ? `Econ: ${topBowl.overs > 0 ? (topBowl.runs / topBowl.overs).toFixed(2) : '0.00'}` : '—', '#ffb74d');

  // 7. Match Overview Breakdown
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  roundRect(ctx, 70, 935, W - 140, 250, 16, true, false);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 70, 935, W - 140, 250, 16, false, true);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 22px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('📊 MATCH HIGHLIGHTS & KEY STATS', 105, 980);

  const tossSummary = match.toss ? `• Toss: ${match.teams?.[match.toss.winner]?.name || match.toss.winner} elected to ${match.toss.choice}` : '• Toss: Recorded';
  const oversSummary = `• Format: ${match.overs || 20} Overs Match`;
  const t1RR = inn1.balls > 0 ? ((inn1.runs / inn1.balls) * 6).toFixed(2) : '0.00';
  const t2RR = inn2.balls > 0 ? ((inn2.runs / inn2.balls) * 6).toFixed(2) : '0.00';
  const runRateSummary = `• Run Rates: ${team1Name} (${t1RR} rpo) vs ${team2Name} (${t2RR} rpo)`;
  const superOverNote = match.isSuperOver ? '• ⚡ Super Over Shootout was played to break the tie!' : `• Match Code: ${match.code || state.room?.code || 'CRK-LIVE'}`;

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '500 22px "Inter", sans-serif';
  ctx.fillText(tossSummary, 105, 1025);
  ctx.fillText(oversSummary, 105, 1065);
  ctx.fillText(runRateSummary, 105, 1105);
  ctx.fillText(superOverNote, 105, 1145);

  // 8. Footer Watermark
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 20px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`🏏 CricketHub • Track, Plan & Score Live Matches • Room: ${match.code || state.room?.code || 'CRK-XXXX'}`, W / 2, 1260);
}

function drawTeamCard(ctx, x, y, w, h, name, inn, color, subLabel) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  roundRect(ctx, x, y, w, h, 16, true, false);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 16, false, true);

  ctx.fillStyle = color;
  ctx.fillRect(x + 20, y, w - 40, 4);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(name.slice(0, 18), x + 24, y + 48);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 16px "Inter", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(subLabel, x + w - 24, y + 48);

  ctx.fillStyle = color;
  ctx.font = '900 68px "Rajdhani", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${inn.runs || 0}/${inn.wickets || 0}`, x + 24, y + 135);

  const ovStr = `${Math.floor((inn.balls || 0) / 6)}.${(inn.balls || 0) % 6} ov`;
  const rrStr = inn.balls > 0 ? `CRR: ${((inn.runs / inn.balls) * 6).toFixed(2)}` : '';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '600 24px "Inter", sans-serif';
  ctx.fillText(`${ovStr}  ${rrStr ? '• ' + rrStr : ''}`, x + 24, y + 185);
}

function drawPerformerCard(ctx, x, y, w, h, label, name, mainStat, subStat, color) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  roundRect(ctx, x, y, w, h, 16, true, false);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 16, false, true);

  ctx.fillStyle = color;
  ctx.font = 'bold 18px "Inter", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 24, y + 42);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px "Inter", sans-serif';
  ctx.fillText(name.slice(0, 20), x + 24, y + 95);

  ctx.fillStyle = color;
  ctx.font = 'bold 32px "Rajdhani", sans-serif';
  ctx.fillText(mainStat, x + 24, y + 155);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 20px "Inter", sans-serif';
  ctx.fillText(subStat, x + 24, y + 205);
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

document.getElementById('btn-close-poster-modal')?.addEventListener('click', () => {
  document.getElementById('poster-modal').style.display = 'none';
});

document.getElementById('poster-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'poster-modal') {
    document.getElementById('poster-modal').style.display = 'none';
  }
});

document.getElementById('btn-download-poster')?.addEventListener('click', () => {
  const canvas = document.getElementById('poster-canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  const code = currentPosterMatch?.code || state.room?.code || 'match';
  link.download = `crickethub-${code}-scorecard.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast('📥 Scorecard poster downloaded!');
});

document.getElementById('btn-share-poster')?.addEventListener('click', async () => {
  const canvas = document.getElementById('poster-canvas');
  if (!canvas) return;
  const code = currentPosterMatch?.code || state.room?.code || 'match';
  const summary = currentPosterMatch?.result?.summary || 'Cricket match scorecard on CricketHub';

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `crickethub-${code}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Cricket Match Scorecard 🏏',
          text: `Check out the match result: ${summary}!`,
          files: [file]
        });
        toast('✅ Match story shared!');
      } catch (err) {
        if (err.name !== 'AbortError') toast('❌ Share cancelled or not supported');
      }
    } else {
      const link = document.createElement('a');
      link.download = `crickethub-${code}-scorecard.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('📥 Image downloaded! Share it directly to WhatsApp / Instagram story.');
    }
  });
});

// ══════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════
init();


