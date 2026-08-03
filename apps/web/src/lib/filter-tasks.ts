import type { TaskRow } from '@nestio/shared';
import type { ViewSelection } from '../state/view.js';
import { todayJstDateString, addDaysToDateString, weekRangeOf } from './datetime.js';
import { isDueOn, isDueInRange, taskDueDateStringJst } from './task-views.js';

function isOverdueOrDueToday(t: TaskRow, today: string): boolean {
  const d = taskDueDateStringJst(t);
  return d !== null && d <= today;
}

/** スマートリスト・リストごとにタスクを絞り込む。リストビューは完了済みも含めて全件返す */
export function filterTasksForView(tasks: TaskRow[], view: ViewSelection): TaskRow[] {
  if (view.type === 'list') {
    return tasks.filter((t) => t.list_id === view.listId);
  }

  const today = todayJstDateString();
  switch (view.key) {
    case 'today':
      return tasks.filter((t) => t.completed_at === null && isOverdueOrDueToday(t, today));
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
