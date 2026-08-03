import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { SyncOp } from '@nestio/shared';
import { createEmptyAppData, type AppData } from './types.js';
import { mergeChanges } from './merge.js';
import { pullChanges, pushOps } from '../api/sync.js';
import { getOrCreateDeviceId } from '../api/device.js';
import { fetchMe, type Me } from '../api/auth.js';

const POLL_INTERVAL_MS = 10_000;

interface AppContextValue {
  me: Me | null;
  loading: boolean;
  data: AppData;
  deviceId: string | null;
  submitOps: (ops: SyncOp[]) => Promise<void>;
  refresh: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const dataRef = useRef<AppData>(createEmptyAppData());
  const [, forceRender] = useState(0);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const bump = useCallback(() => forceRender((n) => n + 1), []);

  const pullLoop = useCallback(
    async (targetSeq?: number) => {
      let since = dataRef.current.since;
      for (;;) {
        const res = await pullChanges(since);
        mergeChanges(dataRef.current, res);
        since = res.next_seq;
        dataRef.current.since = since;
        if (!res.has_more) break;
        if (targetSeq !== undefined && since >= targetSeq) break;
      }
      bump();
    },
    [bump],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetchMe();
        if (cancelled) return;
        setMe(meRes);
        const devId = await getOrCreateDeviceId();
        if (cancelled) return;
        setDeviceId(devId);
        await pullLoop();
      } catch {
        // 未ログイン、またはネットワークエラー。ログイン画面を表示する
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pullLoop]);

  useEffect(() => {
    if (!me) return;
    const timer = setInterval(() => {
      pullLoop().catch(() => {
        /* 次のポーリングで再試行する */
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [me, pullLoop]);

  const submitOps = useCallback(
    async (ops: SyncOp[]) => {
      if (!deviceId) throw new Error('device_id が未初期化です');
      const res = await pushOps(deviceId, ops);
      if (res.rejected.length > 0) {
        await pullLoop();
        throw new Error(`操作が拒否されました: ${res.rejected.map((r) => r.reason).join(', ')}`);
      }
      await pullLoop(res.next_seq);
    },
    [deviceId, pullLoop],
  );

  const value: AppContextValue = {
    me,
    loading,
    data: dataRef.current,
    deviceId,
    submitOps,
    refresh: () => pullLoop(),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppProviderの外でuseAppが呼ばれました');
  return ctx;
}
