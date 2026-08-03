import type { TaskRow, ListSortMode } from '@nestio/shared';
import { naturalCollator } from './datetime.js';
import { taskDueDateStringJst } from './task-views.js';

export function sortTasks(tasks: TaskRow[], mode: ListSortMode): TaskRow[] {
  const arr = [...tasks];

  switch (mode) {
    case 'due':
      arr.sort((a, b) => {
        const da = taskDueDateStringJst(a);
        const db = taskDueDateStringJst(b);
        if (da === null && db === null) return a.sort_order - b.sort_order;
        if (da === null) return 1;
        if (db === null) return -1;
        return da < db ? -1 : da > db ? 1 : 0;
      });
      return arr;
    case 'priority':
      arr.sort((a, b) => {
        // 高(3)→低(1)。「なし」(0)は末尾に来るよう-1として扱う
        const pa = a.priority === 0 ? -1 : a.priority;
        const pb = b.priority === 0 ? -1 : b.priority;
        return pb - pa;
      });
      return arr;
    case 'name':
      arr.sort((a, b) => naturalCollator.compare(a.title, b.title));
      return arr;
    case 'custom':
    default:
      arr.sort((a, b) => a.sort_order - b.sort_order);
      return arr;
  }
}
