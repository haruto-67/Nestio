import { useLists, useTasks } from '../../db/queries.js';
import { taskDueDateStringJst } from '../../lib/task-views.js';
import { todayJstDateString, weekRangeOf } from '../../lib/datetime.js';

/**
 * 「今週の巣」週次レビュー（改修13回目、改修9回目ブレインストーム）。カレンダーとも
 * 一覧とも違う、1週間をひとつの単位として振り返る専用ビュー。完了率・リスト別内訳・
 * 積み残しタスクをまとめて見せる
 */
export function WeeklyReview({ onClose }: { onClose: () => void }) {
  const tasks = useTasks();
  const lists = useLists();

  const today = todayJstDateString();
  const { monday, sunday } = weekRangeOf(today);
  const weekTasks = tasks.filter((t) => {
    const d = taskDueDateStringJst(t);
    return d !== null && d >= monday && d <= sunday;
  });
  const completed = weekTasks.filter((t) => t.completed_at !== null);
  const remaining = weekTasks
    .filter((t) => t.completed_at === null)
    .sort((a, b) => (taskDueDateStringJst(a) ?? '').localeCompare(taskDueDateStringJst(b) ?? ''));
  const completionRate = weekTasks.length > 0 ? Math.round((completed.length / weekTasks.length) * 100) : 0;

  const listNameById = new Map(lists.map((l) => [l.id, l.name]));
  const byList = new Map<string, { total: number; completed: number }>();
  for (const t of weekTasks) {
    const entry = byList.get(t.list_id) ?? { total: 0, completed: 0 };
    entry.total++;
    if (t.completed_at !== null) entry.completed++;
    byList.set(t.list_id, entry);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="nestio-modal-panel flex max-h-[85vh] w-[28rem] max-w-[92vw] flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-4 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            今週の巣（{monday} 〜 {sunday}）
          </h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        <div className="flex flex-col items-center gap-1 rounded-xl bg-violet-50 p-4 dark:bg-violet-950/30">
          <span className="text-3xl font-bold text-violet-500">{completionRate}%</span>
          <span className="text-xs text-muted">
            {completed.length}/{weekTasks.length} 完了
          </span>
        </div>

        {byList.size > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">リスト別内訳</span>
            {[...byList.entries()].map(([listId, stat]) => (
              <div key={listId} className="flex items-center justify-between text-xs">
                <span className="min-w-0 flex-1 truncate">{listNameById.get(listId) ?? '(不明なリスト)'}</span>
                <span className="shrink-0 text-neutral-400">
                  {stat.completed}/{stat.total}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">積み残しタスク（{remaining.length}件）</span>
          {remaining.length === 0 ? (
            <p className="text-xs text-neutral-400">積み残しはありません</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {remaining.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-neutral-400">{taskDueDateStringJst(t)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
