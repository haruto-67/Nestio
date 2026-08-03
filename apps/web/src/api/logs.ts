import { apiClient } from './client.js';

export interface LogEntry {
  level: number;
  time: string;
  msg?: string;
  request_id?: string;
  [key: string]: unknown;
}

export function fetchRecentLogs(options: { level?: 'error' | 'all'; requestId?: string } = {}): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (options.level) params.set('level', options.level);
  if (options.requestId) params.set('request_id', options.requestId);
  const query = params.toString();
  return apiClient.get(`/logs/recent${query ? `?${query}` : ''}`);
}
