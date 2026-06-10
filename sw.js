const CACHE_NAME = 'daily-v2';

// ─── PUSH ────────────────────────────────────────────────────────────────────
self.addEventListener('push', function(e) {
  const data = e.data ? e.data.json() : {};
  const title = data.title || '🔔 DAILY';
  const options = {
    body:    data.body  || '',
    icon:    data.icon  || '/icon-192.png',
    badge:   '/icon-192.png',
    tag:     data.tag   || 'daily-notif',
    data:    { url: data.url || '/' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
    renotify: true,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ─── CLICK ───────────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      // Se já tem uma janela aberta, focar e navegar
      for (const c of cs) {
        if ('focus' in c) {
          c.focus();
          if ('navigate' in c) c.navigate(url);
          return;
        }
      }
      // Senão abrir nova janela
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ─── FETCH (minimal — não quebrar navegação) ──────────────────────────────────
self.addEventListener('fetch', function(e) {
  // Deixar passar tudo — não queremos cache agressivo agora
});

// ─── INSTALL / ACTIVATE ──────────────────────────────────────────────────────
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
