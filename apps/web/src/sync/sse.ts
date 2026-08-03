import { logClientEvent } from './log-buffer.js';

interface BumpHandlers {
  /** SSE接続確立の度に呼ぶ。切断中の取りこぼしを回収するため、接続の都度pullを1回走らせる */
  onConnect: () => void;
  onBump: (seq: number, originDevice: string) => void;
}

const MAX_BACKOFF_MS = 30_000;

export function connectSse(handlers: BumpHandlers): () => void {
  let eventSource: EventSource | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function connect() {
    if (stopped) return;
    eventSource = new EventSource('/api/v1/sync/stream');

    eventSource.onopen = () => {
      reconnectAttempt = 0;
      handlers.onConnect();
    };

    eventSource.addEventListener('bump', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as { seq: number; origin_device: string };
        handlers.onBump(data.seq, data.origin_device);
      } catch {
        // 壊れたペイロードは無視
      }
    });

    eventSource.onerror = () => {
      eventSource?.close();
      eventSource = null;
      if (stopped) return;

      const delay = Math.min(1000 * 2 ** reconnectAttempt, MAX_BACKOFF_MS);
      logClientEvent('warn', 'sse_disconnected', { retry_in_ms: delay });
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };
  }

  connect();

  return () => {
    stopped = true;
    eventSource?.close();
    eventSource = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}
