import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { getSyncStatus, subscribeSyncStatus } from '../sync/engine.js';

function formatAgo(ms: number): string {
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 5) return 'たった今';
  if (diffSec < 60) return `${diffSec}秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  return `${Math.floor(diffHour / 24)}日前`;
}

/** 「最終同期: N分前」の常設ステータス表示（改修5回目。改修4回目ブレインストーム案G「可観測性」） */
export function SyncStatusIndicator() {
  const [status, setStatus] = useState(getSyncStatus);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [, forceTick] = useState(0);

  useEffect(() => subscribeSyncStatus(() => setStatus(getSyncStatus())), []);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  // 「N分前」の表示を定期的に更新するため1分ごとに再レンダリングする
  useEffect(() => {
    const timer = setInterval(() => forceTick((v) => v + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!online) {
    return (
      <span
        title="オフラインです。復帰すると自動で同期します"
        className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-amber-500"
      >
        <WifiOff size={12} />
        オフライン
      </span>
    );
  }

  if (status.lastError) {
    return (
      <span
        title="直近の同期に失敗しました"
        className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-red-500"
      >
        <RefreshCw size={12} />
        同期エラー
      </span>
    );
  }

  if (status.lastSyncAt === null) return null;

  return (
    <span title="最終同期時刻" className="shrink-0 text-xs whitespace-nowrap text-neutral-400">
      最終同期: {formatAgo(status.lastSyncAt)}
    </span>
  );
}
