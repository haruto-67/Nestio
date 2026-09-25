import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchMe, type Me } from '../api/auth.js';
import { getOrCreateDeviceId, getCachedDeviceId } from '../api/device.js';
import { ApiRequestError } from '../api/client.js';
import { pullLoop, syncNow, setDeviceId } from '../sync/engine.js';
import { connectSse } from '../sync/sse.js';
import { logClientEvent } from '../sync/log-buffer.js';
import { getMeta, setMeta, META_KEYS } from '../db/schema.js';

// 回線の悪い場所で起動すると、サーバーへの接続を延々と待ち続けてしまう（改修23回目）。
// オフライン編集機能（IndexedDBのローカルデータ）があるので、この時間を超えたら
// キャッシュ済みのユーザー情報でオフラインのまま起動を続ける
const STARTUP_NETWORK_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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

  useEffect(() => {
    let cancelled = false;

    // ログイン確認→端末登録→同期→SSE購読までの一連の流れ。起動時だけでなく、'online'復帰時の
    // 再接続にも同じ関数を使う（改修23回目：オフラインフォールバック後に回線が戻った時の
    // 再接続と、初回タイムアウト後にバックグラウンドで遅れて成功した場合の両方をこれ1つで扱う）
    async function connectOnline(): Promise<void> {
      const meRes = await fetchMe();
      if (cancelled) return;
      setMe(meRes);
      // 次回オフライン起動時に使うため、直近のログイン成功情報をキャッシュしておく
      await setMeta(META_KEYS.cachedMe, meRes);

      const devId = await getOrCreateDeviceId();
      if (cancelled) return;
      setDeviceIdState(devId);
      setDeviceId(devId);

      await syncNow();
      if (cancelled) return;

      // 再接続時は必ずpullを1回走らせる（切断中の取りこぼし回収。sync-protocol.md 7章）。
      // 切断中にオフラインで溜まったoutboxがあるかもしれないためpush→pullの順で行う。
      // 既に接続済みなら二重に張らない
      if (!sseCleanupRef.current) {
        sseCleanupRef.current = connectSse({
          onConnect: () => {
            syncNow().catch((err) => logClientEvent('warn', 'sync_after_connect_failed', { error: String(err) }));
          },
          onBump: (_seq, originDevice) => {
            if (originDevice === devId) return; // 自分の書き込みの反響は無視
            pullLoop().catch((err) => logClientEvent('warn', 'pull_after_bump_failed', { error: String(err) }));
          },
        });
      }
    }

    const handleOnline = () => {
      logClientEvent('info', 'network_online');
      connectOnline().catch((err) => logClientEvent('warn', 'sync_after_online_failed', { error: String(err) }));
    };
    window.addEventListener('online', handleOnline);

    // タブへ戻った時にも1回同期する（改修26回目）。PCのスリープ復帰直後などはSSEの死活監視が
    // 張り直すまで最大1分程度かかるため、ユーザーが画面を見た瞬間に最新化しておく
    const handleVisible = () => {
      if (document.visibilityState !== 'visible' || !sseCleanupRef.current) return;
      syncNow().catch((err) => logClientEvent('warn', 'sync_on_visible_failed', { error: String(err) }));
    };
    document.addEventListener('visibilitychange', handleVisible);

    (async () => {
      try {
        // 回線の悪い場所ではサーバーへの接続確認自体が長時間かかることがある。
        // オフライン編集機能があるので、短めのタイムアウトを超えたら待たずに先へ進む（改修23回目）。
        // connectOnline自体は中断せずバックグラウンドで走り続け、遅れて成功すればその時点で
        // 通常通りsetMe等が反映される
        await withTimeout(connectOnline(), STARTUP_NETWORK_TIMEOUT_MS);
      } catch (err) {
        if (cancelled) return;
        // サーバーが実際に応答した上でのエラー（401等）は素直に未ログイン扱いにする。
        // キャッシュを表示すると、別ユーザーへの切り替え後にも前のユーザー情報が
        // 残ってしまう恐れがあるため、フォールバックはネットワーク到達不可の時だけに限る
        if (!(err instanceof ApiRequestError)) {
          const cachedMe = await getMeta<Me | null>(META_KEYS.cachedMe, null);
          const cachedDeviceId = getCachedDeviceId();
          if (cachedMe && cachedDeviceId) {
            logClientEvent('warn', 'startup_offline_fallback', { error: String(err) });
            setMe(cachedMe);
            setDeviceIdState(cachedDeviceId);
            setDeviceId(cachedDeviceId);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      sseCleanupRef.current?.();
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisible);
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
