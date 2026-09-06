const CACHE_NAME = 'crickethub-v30';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do not intercept non-GET, Socket.IO, or API calls
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Network-first strategy for scripts, stylesheets, and navigation
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html') || caches.match('/');
          }
        });
      })
  );
});

// ═══════════════════════════════════════════════
//  W3C OS-LEVEL WEB PUSH NOTIFICATIONS (IDLE / LOCKSCREEN)
// ═══════════════════════════════════════════════

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { message: event.data.text() };
    }
  }

  const title = data.title || '⚡ Cricket Match Alert!';
  const message = data.message || (data.matchName ? `${data.author || 'Host'} pinged for match ${data.matchName}!` : 'Cricket match update!');
  
  const options = {
    body: message,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'crickethub-alert-' + (data.roomCode || data.id || Date.now()),
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: '/',
      roomCode: data.roomCode || null,
      autoVote: data.autoVote || null,
      ...data
    },
    actions: [
      { action: 'open', title: '🏏 View Match' },
      { action: 'coming', title: '✅ I\'m Coming!' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const action = event.action;

  const targetUrl = notifData.roomCode 
    ? `/?room=${encodeURIComponent(notifData.roomCode)}${action === 'coming' ? '&vote=coming' : '&view=planning'}`
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it and notify client
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (notifData.roomCode) {
            client.postMessage({
              type: 'OPEN_ROOM',
              roomCode: notifData.roomCode,
              autoVote: action === 'coming' ? 'coming' : null,
              forcePlanning: true
            });
          }
          return;
        }
      }
      // If no window open, open new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
