import { useState, useEffect, useRef } from 'react';
import type { SearchResponse } from '@nestio/shared';
import { search } from '../../api/search.js';

const EMPTY_RESULTS: SearchResponse = { tasks: [], notes: [] };
const DEBOUNCE_MS = 200;

interface SearchModalProps {
  onClose: () => void;
  onSelectTask: (taskId: string, listId: string) => void;
}

export function SearchModal({ onClose, onSelectTask }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      search(trimmed)
        .then((res) => {
          if (!cancelled) setResults(res);
        })
        .catch(() => {
          if (!cancelled) setResults(EMPTY_RESULTS);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const trimmed = query.trim();
  const hasNoResults = !loading && trimmed !== '' && results.tasks.length === 0 && results.notes.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-900"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          placeholder="タスク・メモを検索"
          className="w-full border-b border-neutral-200 bg-transparent pb-2 text-lg outline-none dark:border-neutral-700"
        />

        <div className="mt-3 max-h-96 overflow-y-auto">
          {loading && <p className="px-1 py-2 text-xs text-neutral-400">検索中…</p>}
          {hasNoResults && <p className="p-4 text-center text-sm text-neutral-400">見つかりませんでした</p>}

          {results.tasks.length > 0 && (
            <div className="mb-2">
              <h3 className="px-1 py-1 text-xs font-semibold text-neutral-400">タスク</h3>
              {results.tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    onSelectTask(t.id, t.list_id);
                    onClose();
                  }}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}

          {results.notes.length > 0 && (
            <div>
              <h3 className="px-1 py-1 text-xs font-semibold text-neutral-400">メモ</h3>
              {results.notes.map((n) => (
                <div key={n.id} className="truncate px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                  {n.title}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
