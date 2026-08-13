import { RotateCcw } from 'lucide-react';
import { useDeletedTasks, useDeletedNotes } from '../../db/queries.js';
import { restoreTask, restoreNote } from '../../state/actions.js';

/**
 * 論理削除(deleted_at)されたタスク・メモの一覧。復元(deleted_at=null)のみを提供し、
 * 物理削除はGCワーカーに委ねる（CLAUDE.md「絶対に守ること」5.論理削除のみ）。
 * 30日経過すると自動的に物理削除される（docs/sync-protocol.md）。
 */
export function TrashView({ onClose }: { onClose: () => void }) {
  const deletedTasks = useDeletedTasks();
  const deletedNotes = useDeletedNotes();

  const sortedTasks = [...deletedTasks].sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));
  const sortedNotes = [...deletedNotes].sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-96 flex-col rounded-xl bg-white p-4 shadow-lg dark:bg-neutral-900 nestio-modal-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">ゴミ箱</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>
        <p className="mb-3 text-xs text-neutral-400">削除から30日経過すると自動的に完全削除されます</p>

        <div className="flex-1 overflow-y-auto">
          <h3 className="mb-1 text-xs font-semibold text-neutral-500">タスク</h3>
          {sortedTasks.length === 0 ? (
            <p className="mb-3 text-xs text-neutral-400">削除済みのタスクはありません</p>
          ) : (
            <ul className="mb-3 flex flex-col gap-1">
              {sortedTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">{t.title}</span>
                  <button
                    onClick={() => restoreTask(t.id)}
                    title="復元"
                    className="flex min-h-8 min-w-8 items-center justify-center gap-1 text-xs text-blue-500"
                  >
                    <RotateCcw size={13} />
                    復元
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mb-1 text-xs font-semibold text-neutral-500">メモ</h3>
          {sortedNotes.length === 0 ? (
            <p className="text-xs text-neutral-400">削除済みのメモはありません</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sortedNotes.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">
                    {n.title || '無題'}
                  </span>
                  <button
                    onClick={() => restoreNote(n.id)}
                    title="復元"
                    className="flex min-h-8 min-w-8 items-center justify-center gap-1 text-xs text-blue-500"
                  >
                    <RotateCcw size={13} />
                    復元
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
