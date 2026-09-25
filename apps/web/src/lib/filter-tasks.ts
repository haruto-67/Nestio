import { isInTodayView, type TaskRow } from '@nestio/shared';
import type { ViewSelection } from '../state/view.js';
import { todayJstDateString, addDaysToDateString, weekRangeOf } from './datetime.js';
import { isDueOn, isDueInRange, taskDueDateStringJst } from './task-views.js';

/** スマートリスト・リストごとにタスクを絞り込む。リストビューは完了済みも含めて全件返す */
export function filterTasksForView(tasks: TaskRow[], view: ViewSelection): TaskRow[] {
  if (view.type === 'list') {
    return tasks.filter((t) => t.list_id === view.listId);
  }
  // タグの組み合わせによるカスタムビュー（改修5回目）。タグでの絞り込み自体はTaskListView側で行うため、
  // ここでは「すべて」と同じ未完了全件を返す
  if (view.type === 'custom') {
    return tasks.filter((t) => t.completed_at === null);
  }

  const today = todayJstDateString();
  switch (view.key) {
    case 'today':
      // ダッシュボードAPI（GET /api/v1/dashboard/today）と同じ判定を使う（改修26回目）
      return tasks.filter((t) => isInTodayView(t, today));
    case 'tomorrow': {
      const tomorrow = addDaysToDateString(today, 1);
      return tasks.filter((t) => t.completed_at === null && isDueOn(t, tomorrow));
    }
    case 'week': {
      const { sunday } = weekRangeOf(today);
      return tasks.filter((t) => t.completed_at === null && isDueInRange(t, today, sunday));
    }
    case 'no_due':
      return tasks.filter((t) => t.completed_at === null && taskDueDateStringJst(t) === null);
    case 'all':
      return tasks.filter((t) => t.completed_at === null);
    case 'completed':
      return tasks.filter((t) => t.completed_at !== null);
  }
}
