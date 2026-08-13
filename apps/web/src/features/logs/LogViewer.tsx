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

export function LogViewer({ onClose }: { onClose: () => void }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[40rem] flex-col rounded-xl bg-white p-4 shadow-lg dark:bg-neutral-900 nestio-modal-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">ログビューア</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        <div className="mb-3 flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
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

        <div className="flex-1 overflow-y-auto">
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
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-neutral-500 dark:text-neutral-400">
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
