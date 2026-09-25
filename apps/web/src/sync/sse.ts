import { logClientEvent } from './log-buffer.js';

interface BumpHandlers {
  /** SSE接続確立の度に呼ぶ。切断中の取りこぼしを回収するため、接続の都度pullを1回走らせる */
  onConnect: () => void;
  onBump: (seq: number, originDevice: string) => void;
}

const MAX_BACKOFF_MS = 30_000;
/**
 * サーバーは無通信時に30秒ごとにpingを送る（apps/api/src/routes/sync.ts）。これが2回分以上
 * 途絶えたら、途中の経路で黙って切られた「死んだ接続」とみなして張り直す（改修26回目：
 * EventSourceはこの状態をonerrorで教えてくれないため、PCで開きっぱなしのタブに他端末の
 * 変更が再読み込みまで届かなかった）。張り直すとonConnectのpullで取りこぼしも回収される
 */
const STALE_AFTER_MS = 75_000;

export function connectSse(handlers: BumpHandlers): () => void {
  let eventSource: EventSource | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let lastEventAt = Date.now();
  const watchdog = setInterval(() => {
    if (!eventSource || Date.now() - lastEventAt < STALE_AFTER_MS) return;
    logClientEvent('warn', 'sse_stale', { silent_ms: Date.now() - lastEventAt });
    eventSource.close();
    eventSource = null;
    reconnectAttempt = 0;
    connect();
  }, 15_000);

  function connect() {
    if (stopped) return;
    eventSource = new EventSource('/api/v1/sync/stream');
    lastEventAt = Date.now();

    eventSource.onopen = () => {
      lastEventAt = Date.now();
      reconnectAttempt = 0;
      handlers.onConnect();
    };

    eventSource.addEventListener('ping', () => {
      lastEventAt = Date.now();
    });

    eventSource.addEventListener('bump', (e) => {
      lastEventAt = Date.now();
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
    clearInterval(watchdog);
    eventSource?.close();
    eventSource = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}
