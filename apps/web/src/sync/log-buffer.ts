import { uuidv7, type ClientLogEntry, type ClientLogLevel } from '@nestio/shared';

const MAX_ENTRIES = 200;
let buffer: ClientLogEntry[] = [];

/** アプリ起動ごとに1つ。POST /client-logsのrequest_id相当として使う */
export const sessionTraceId = uuidv7();

/**
 * 同期障害（outbox送信失敗・resync・衝突解決・SSE切断/再接続）を端末側に残す。
 * サーバーへは自動送信しない。設定画面からの手動送信でのみ /client-logs に届く。
 */
export function logClientEvent(
  level: ClientLogLevel,
  message: string,
  context?: Record<string, unknown>,
): void {
  buffer.push({ level, message, context, timestamp: Date.now() });
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
  if (level === 'error' || level === 'warn') {
    console.warn(`[nestio:${level}] ${message}`, context ?? '');
  }
}

export function getLogBuffer(): ClientLogEntry[] {
  return [...buffer];
}

export function clearLogBuffer(): void {
  buffer = [];
}
