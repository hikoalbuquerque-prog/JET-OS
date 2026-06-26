// firebase-messaging-sw.js
// Service Worker para FCM (Firebase Cloud Messaging) — JET OS V2
// Coloque em: frontend/public/firebase-messaging-sw.js
//
// IMPORTANTE: Este arquivo NÃO pode usar import/export.
// Deve usar importScripts e a config explícita do projeto.

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Config do projeto jet-os-1
// Mantida aqui porque o SW não tem acesso ao bundle do React
firebase.initializeApp({
  apiKey:            "AIzaSyAPBQfV2wq4GD6AZxqmzTZ_rvFHjbWepMk",
  authDomain:        "jet-os-1.firebaseapp.com",
  projectId:         "jet-os-1",
  storageBucket:     "jet-os-1.firebasestorage.app",
  messagingSenderId: "727065543526",
  appId:             "1:727065543526:web:ac0d6831f4350f08d07ea7"
});

const messaging = firebase.messaging();

// Notificação em background (app fechado/em outra aba)
messaging.onBackgroundMessage(payload => {
  console.log('[SW] Mensagem em background:', payload);

  const { title, body, icon, badge, data } = payload.notification || {};
  const notifTitle = title || 'JET OS';
  const notifOptions = {
    body:  body  || '',
    icon:  icon  || '/logo192.png',
    badge: badge || '/logo192.png',
    tag:   data?.tag || 'jet-notif',
    data:  data  || {},
    actions: data?.tipo === 'confirmacao_slot' ? [
      { action: 'confirmar', title: '✅ Confirmar' },
      { action: 'recusar',   title: '❌ Recusar'   },
    ] : [],
    vibrate:    [200, 100, 200],
    renotify:   true,
    requireInteraction: data?.urgente === 'true',
  };

  self.registration.showNotification(notifTitle, notifOptions);
});

// Clique na notificação
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const data  = event.notification.data || {};
  const action = event.action;
  const url   = data.url || '/';

  if (action === 'confirmar' && data.slotId) {
    // Abre app na rota de confirmação de slot
    event.waitUntil(
      clients.openWindow(`/?confirmarSlot=${data.slotId}`)
    );
    return;
  }

  if (action === 'recusar' && data.slotId) {
    event.waitUntil(
      clients.openWindow(`/?recusarSlot=${data.slotId}`)
    );
    return;
  }

  // Clique padrão: foca janela existente ou abre nova
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Instalação e ativação silenciosas
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));
