// vite-plugin-pwa の generateSW が生成する sw.js から importScripts で読み込まれる。
// 期限リマインダー・ポモドーロ終了はサーバー側でスケジュールされ、ここでは受信して表示するだけ
// （Service Workerのバックグラウンドタイマーはブラウザに停止されるため信頼できない。要件定義3.4）。
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Nestio', {
      body: payload.body ?? '',
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
