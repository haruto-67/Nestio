import { useEffect, useState } from 'react';
import { fetchRecentLogs, type LogEntry } from '../../api/logs.js';
import { formatDateTimeJst } from '../../lib/datetime.js';

const LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

const LEVEL_COLORS: Record<number, string> = {
  50: 'text-red-500',
  60: 'text-red-500',
  40: 'text-amber-500',
};

/**
 * ログ一覧の中身部分だけを切り出したコンポーネント（改修13回目：管理者パネルの
 * タブ化に伴い、以前は独立モーダルだったログビューアをタブの中身として埋め込む形に
 * 変更した。外枠のモーダル・ヘッダーは呼び出し元（AdminPanel）が持つ）
 */
export function LogViewerContent() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [errorOnly, setErrorOnly] = useState(true);
  const [requestId, setRequestId] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchRecentLogs({ level: errorOnly ? 'error' : 'all', requestId: requestId.trim() || undefined })
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  };

  // errorOnly変更時のみ再取得する。requestIdは「更新」ボタン/Enterで明示的に反映する
  useEffect(() => {
    load();
  }, [errorOnly]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={errorOnly} onChange={(e) => setErrorOnly(e.target.checked)} />
          エラーのみ
        </label>
        <input
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="request_id で絞り込み"
          className="flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          onClick={load}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          更新
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && <p className="text-xs text-neutral-400">読み込み中…</p>}
        {!loading && entries.length === 0 && <p className="text-xs text-neutral-400">ログはありません</p>}
        <ul className="flex flex-col gap-1">
          {entries.map((entry, i) => (
            <li key={i} className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-700">
              <button
                className="flex w-full items-start gap-2 text-left"
                onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
              >
                <span className={`shrink-0 font-mono ${LEVEL_COLORS[entry.level] ?? 'text-neutral-400'}`}>
                  {LEVEL_LABELS[entry.level] ?? entry.level}
                </span>
                <span className="shrink-0 text-neutral-400">
                  {(() => {
                    const t = Date.parse(entry.time);
                    return Number.isNaN(t) ? entry.time : formatDateTimeJst(t);
                  })()}
                </span>
                <span className="truncate">{entry.msg ?? ''}</span>
              </button>
              {expandedIndex === i && (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-muted">
                  {JSON.stringify(entry, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
