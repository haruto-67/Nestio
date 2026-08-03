import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchMe, type Me } from '../api/auth.js';
import { getOrCreateDeviceId } from '../api/device.js';
import { pullLoop, syncNow, setDeviceId } from '../sync/engine.js';
import { connectSse } from '../sync/sse.js';
import { logClientEvent } from '../sync/log-buffer.js';

interface AppContextValue {
  me: Me | null;
  loading: boolean;
  deviceId: string | null;
  syncNow: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * 起動時に push→pull で同期してからSSE購読を開始する。
 * データの読み取り自体はここでは持たず、各コンポーネントが db/queries.ts の
 * useLiveQuery系フックでIndexedDBを直接見る（CLAUDE.md 絶対原則4）。
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [deviceId, setDeviceIdState] = useState<string | null>(null);
  const sseCleanupRef = useRef<(() => void) | null>(null);
  const cleanupOnlineListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const meRes = await fetchMe();
        if (cancelled) return;
        setMe(meRes);

        const devId = await getOrCreateDeviceId();
        if (cancelled) return;
        setDeviceIdState(devId);
        setDeviceId(devId);

        await syncNow();
        if (cancelled) return;

        // 再接続時は必ずpullを1回走らせる（切断中の取りこぼし回収。sync-protocol.md 7章）。
        // 切断中にオフラインで溜まったoutboxがあるかもしれないためpush→pullの順で行う
        sseCleanupRef.current = connectSse({
          onConnect: () => {
            syncNow().catch((err) => logClientEvent('warn', 'sync_after_connect_failed', { error: String(err) }));
          },
          onBump: (_seq, originDevice) => {
            if (originDevice === devId) return; // 自分の書き込みの反響は無視
            pullLoop().catch((err) => logClientEvent('warn', 'pull_after_bump_failed', { error: String(err) }));
          },
        });

        const handleOnline = () => {
          logClientEvent('info', 'network_online');
          syncNow().catch((err) => logClientEvent('warn', 'sync_after_online_failed', { error: String(err) }));
        };
        window.addEventListener('online', handleOnline);
        cleanupOnlineListenerRef.current = () => window.removeEventListener('online', handleOnline);
      } catch {
        // 未ログイン、またはネットワークエラー。ログイン画面を表示する
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      sseCleanupRef.current?.();
      cleanupOnlineListenerRef.current?.();
    };
  }, []);

  const value: AppContextValue = { me, loading, deviceId, syncNow };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppProviderの外でuseAppが呼ばれました');
  return ctx;
}
