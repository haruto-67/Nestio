import { apiClient } from './client.js';

export interface SessionInfo {
  id: string;
  created_at: number;
  expires_at: number;
  device_label: string | null;
  device_last_seen: number | null;
  is_current: boolean;
}

export function listSessions(): Promise<SessionInfo[]> {
  return apiClient.get('/auth/sessions');
}

export function revokeSession(id: string): Promise<void> {
  return apiClient.del(`/auth/sessions/${id}`);
}
