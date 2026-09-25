import { compareTasksByDue, type TaskRow, type ListSortMode } from '@nestio/shared';
import { naturalCollator } from './datetime.js';

export function sortTasks(tasks: TaskRow[], mode: ListSortMode): TaskRow[] {
  const arr = [...tasks];

  switch (mode) {
    case 'due':
      // ダッシュボードAPIの「今日」と同じ並び順にするためpackages/sharedの比較関数を使う（改修26回目）
      arr.sort(compareTasksByDue);
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
