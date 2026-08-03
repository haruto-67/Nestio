import { apiClient } from './client.js';
import { getLogBuffer, clearLogBuffer, sessionTraceId } from '../sync/log-buffer.js';

export async function sendClientLogs(deviceId: string): Promise<number> {
  const entries = getLogBuffer();
  if (entries.length === 0) return 0;

  await apiClient.post('/client-logs', {
    device_id: deviceId,
    session_trace_id: sessionTraceId,
    entries,
  });
  clearLogBuffer();
  return entries.length;
}
