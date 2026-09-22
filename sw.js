const CACHE = 'instant-rccard-shell-v21';
const SHELL = ['/', '/index.html', '/app.js', '/manifest.webmanifest', '/instant-rccard-logo.png', '/instant-rccard-mark.png', '/instant-rccard-icon-192-v21.png', '/instant-rccard-icon-512-v21.png', '/whatsapp.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  var payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (error) { payload = { title: 'InstantRCcard', body: event.data ? event.data.text() : 'New activity' }; }
  var title = payload.title || 'InstantRCcard activity';
  var options = {
    body: payload.body || 'New activity received.',
    icon: payload.icon || '/instant-rccard-icon-192-v21.png',
    badge: payload.badge || '/instant-rccard-icon-192-v21.png',
    tag: payload.tag || 'instant-rccard-activity',
    data: payload.data || { url: '/' },
    requireInteraction: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  var target = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((pages) => {
    for (var i = 0; i < pages.length; i += 1) {
      if ('focus' in pages[i]) { pages[i].navigate(target); return pages[i].focus(); }
    }
    return clients.openWindow(target);
  }));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
  );
});
