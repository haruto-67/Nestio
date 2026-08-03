import type { SyncOp, SyncPullResponse, SyncPushRequest, SyncPushResponse } from '@nestio/shared';
import { apiClient } from './client.js';

export function pullChanges(since: number, limit = 500): Promise<SyncPullResponse> {
  return apiClient.get<SyncPullResponse>(`/sync/pull?since=${since}&limit=${limit}`);
}

export function pushOps(deviceId: string, ops: SyncOp[]): Promise<SyncPushResponse> {
  const body: SyncPushRequest = { device_id: deviceId, ops };
  return apiClient.post<SyncPushResponse>('/sync/push', body);
}
