self.addEventListener('push', function(e) {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '📷 DAILY';
  const options = {
    body:  data.body  || 'Hora da foto!',
    icon:  data.icon  || '/icon-192.png',
    badge: '/icon-192.png',
    data:  { url: data.url || '/' },
    requireInteraction: true,
    vibrate: [200, 100, 200]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.matchAll({ type:'window' }).then(cs => {
    for (const c of cs) { if (c.url === url && 'focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});

self.addEventListener('fetch', function(e) {});
