/* WASL service worker: Web Push display + click routing. No caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'وصل', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'وصل';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/parent' },
      dir: 'rtl',
      lang: 'ar',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let u;
  try {
    u = new URL((event.notification.data && event.notification.data.url) || '/parent', self.location.origin);
  } catch (e) {
    u = null;
  }
  if (!u || u.origin !== self.location.origin) u = new URL('/parent', self.location.origin);
  const url = u.href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
