import { fetchVapidPublicKey, subscribePush, unsubscribePush } from '../api/push.js';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  return bytes.buffer;
}

/**
 * 通知許諾は必ずユーザー操作を起点に呼び出すこと（自動表示は不可。docs/manual-setup.md B-2）。
 * iOSはホーム画面に追加した場合のみWeb Pushが機能する。
 */
export async function enablePushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('このブラウザは通知に対応していません');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('通知が許可されませんでした');
  }

  const registration = await navigator.serviceWorker.ready;
  const { public_key } = await fetchVapidPublicKey();
  if (!public_key) {
    throw new Error('サーバー側でVAPID鍵が未設定です（docs/manual-setup.md B-1）');
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(public_key),
  });

  await subscribePush(subscription.toJSON() as PushSubscriptionJSON);
}

export async function disablePushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await unsubscribePush(subscription.endpoint);
  await subscription.unsubscribe();
}

export async function getPushPermissionState(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
