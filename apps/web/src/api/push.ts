import { apiClient } from './client.js';

export function fetchVapidPublicKey(): Promise<{ public_key: string }> {
  return apiClient.get('/push/vapid-public-key');
}

export function subscribePush(subscription: PushSubscriptionJSON): Promise<void> {
  return apiClient.post('/push/subscribe', { endpoint: subscription.endpoint, keys: subscription.keys });
}

export function unsubscribePush(endpoint: string): Promise<void> {
  return apiClient.del('/push/subscribe', { endpoint });
}

export function sendTestPush(): Promise<{ subscription_count: number }> {
  return apiClient.post('/push/test', {});
}

export function schedulePomodoroPush(durationSec: number, taskId?: string): Promise<{ id: string }> {
  return apiClient.post('/pomodoro/schedule', { duration_sec: durationSec, task_id: taskId });
}

export function cancelPomodoroPush(id: string): Promise<void> {
  return apiClient.del(`/pomodoro/schedule/${id}`);
}
