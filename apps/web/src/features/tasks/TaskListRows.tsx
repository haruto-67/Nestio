import type { ListSortMode, TaskRow } from '@nestio/shared';
import type { ViewSelection } from '../../state/view.js';
import { buildTaskTree } from '../../lib/task-tree.js';
import { sortTasks } from '../../lib/task-sort.js';
import { taskDueDateStringJst } from '../../lib/task-views.js';
import { todayJstDateString } from '../../lib/datetime.js';
import { TaskItem } from './TaskItem.js';

export interface SharedListProps {
  sortMode: ListSortMode;
  canComplete: (taskId: string) => boolean;
  predecessorTitle: (taskId: string) => string | null;
  onToggleComplete: (taskId: string, completing: boolean) => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
  onAddSubtask: (taskId: string) => void;
  onDropOntoTask: (draggedTaskId: string, targetTaskId: string) => void;
  onDelete: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: 0 | 1 | 2 | 3) => void;
}

/** view.type === 'list' なら親子構造を保ったツリー表示、それ以外（スマートリスト等）は
 * フラットな並びで表示する（改修13回目：見通し改善のためTaskListView.tsxから切り出した） */
export function TaskTreeOrFlat({
  view,
  tasks,
  sortMode,
  canComplete,
  predecessorTitle,
  onToggleComplete,
  onSelect,
  selectedTaskId,
  onAddSubtask,
  onDropOntoTask,
  onDelete,
  onSetPriority,
}: SharedListProps & { view: ViewSelection; tasks: TaskRow[] }) {
  if (view.type === 'list') {
    const tree = buildTaskTree(tasks, sortMode);
    return (
      <>
        {tree.map((node) => (
          <TaskItem
            key={node.task.id}
            node={node}
            depth={0}
            canComplete={canComplete}
            predecessorTitle={predecessorTitle}
            onToggleComplete={onToggleComplete}
            onSelect={onSelect}
            onAddSubtask={onAddSubtask}
            onDropOntoTask={onDropOntoTask}
            onDelete={onDelete}
            onSetPriority={onSetPriority}
            selectedTaskId={selectedTaskId}
          />
        ))}
      </>
    );
  }

  const sorted = sortTasks(tasks, sortMode);
  return (
    <>
      {sorted.map((task) => (
        <TaskItem
          key={task.id}
          node={{ task, children: [] }}
          depth={0}
          canComplete={canComplete}
          predecessorTitle={predecessorTitle}
          onToggleComplete={onToggleComplete}
          onSelect={onSelect}
          onAddSubtask={onAddSubtask}
          onDropOntoTask={onDropOntoTask}
          onDelete={onDelete}
          onSetPriority={onSetPriority}
          selectedTaskId={selectedTaskId}
        />
      ))}
    </>
  );
}

/** 「今日」ビュー専用：期限切れ/今日の2セクションに区分して表示する */
export function TodayViewSections({
  tasks,
  sortMode,
  canComplete,
  predecessorTitle,
  onToggleComplete,
  onSelect,
  selectedTaskId,
  onAddSubtask,
  onDropOntoTask,
  onDelete,
  onSetPriority,
}: SharedListProps & { tasks: TaskRow[] }) {
  const today = todayJstDateString();
  const overdue = sortTasks(
    tasks.filter((t) => {
      const d = taskDueDateStringJst(t);
      return d !== null && d < today;
    }),
    sortMode,
  );
  const dueToday = sortTasks(
    tasks.filter((t) => taskDueDateStringJst(t) === today),
    sortMode,
  );

  return (
    <>
      {overdue.length > 0 && (
        <div className="mb-2">
          <h2 className="px-2 py-1 text-xs font-semibold text-red-500">期限切れ</h2>
          {overdue.map((task) => (
            <TaskItem
              key={task.id}
              node={{ task, children: [] }}
              depth={0}
              canComplete={canComplete}
              predecessorTitle={predecessorTitle}
              onToggleComplete={onToggleComplete}
              onSelect={onSelect}
              onAddSubtask={onAddSubtask}
              onDropOntoTask={onDropOntoTask}
              onDelete={onDelete}
              onSetPriority={onSetPriority}
              selectedTaskId={selectedTaskId}
            />
          ))}
        </div>
      )}
      {dueToday.length > 0 && (
        <div>
          <h2 className="px-2 py-1 text-xs font-semibold text-neutral-400">今日</h2>
          {dueToday.map((task) => (
            <TaskItem
              key={task.id}
              node={{ task, children: [] }}
              depth={0}
              canComplete={canComplete}
              predecessorTitle={predecessorTitle}
              onToggleComplete={onToggleComplete}
              onSelect={onSelect}
              onAddSubtask={onAddSubtask}
              onDropOntoTask={onDropOntoTask}
              onDelete={onDelete}
              onSetPriority={onSetPriority}
              selectedTaskId={selectedTaskId}
            />
          ))}
        </div>
      )}
    </>
  );
}
