/*
 * Service worker: the only reason the phone can be told anything while the
 * browser is shut.
 *
 * Deliberately tiny. It shows a notification and opens the right session when
 * tapped; it does not cache, because there is nothing here worth serving stale.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {
    title: 'claude-remote',
    body: 'Something needs you.',
    sessionId: '',
    kind: 'blocked',
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // A payload we cannot read is still worth surfacing.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // Same tag per session, so a second alert replaces the first rather than
      // stacking up while you are away from your phone.
      tag: `cr-${data.sessionId || 'general'}`,
      renotify: true,
      requireInteraction: data.kind === 'blocked',
      data: { sessionId: data.sessionId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.sessionId;
  const url = id && id !== 'test' ? `/terminal/${id}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Reuse a tab if one is already open — landing in a second copy of the
      // app is disorienting when you are half-awake on a bus.
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
