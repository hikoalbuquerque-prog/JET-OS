self.addEventListener('push', function(event) {
  if (!event.data) return;
  try {
    var payload = event.data.json();
    var options = {
      body: payload.body || '',
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-192.png',
      data: payload.data || {},
      vibrate: [200, 100, 200],
      tag: payload.tag || 'jet-os-push',
      renotify: true,
    };
    event.waitUntil(
      self.registration.showNotification(payload.title || 'Jet OS', options)
    );
  } catch (e) {
    console.error('[push-sw] erro ao processar push:', e);
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url.includes(self.location.origin) && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
