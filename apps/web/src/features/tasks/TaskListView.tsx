import { useEffect, useState } from 'react';
import { uuidv7, type ListSortMode, type TaskRow } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { useLists, useTasks } from '../../db/queries.js';
import type { ViewSelection } from '../../state/view.js';
import { filterTasksForView } from '../../lib/filter-tasks.js';
import { buildTaskTree, flattenTaskTree } from '../../lib/task-tree.js';
import { sortTasks } from '../../lib/task-sort.js';
import { taskDueDateStringJst, SMART_LISTS } from '../../lib/task-views.js';
import { todayJstDateString } from '../../lib/datetime.js';
import { upsertTask, upsertList, completeTask } from '../../state/actions.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { TaskItem } from './TaskItem.js';

interface TaskListViewProps {
  view: ViewSelection;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onVisibleTasksChange?: (ids: string[]) => void;
  quickAddInputRef?: (el: HTMLInputElement | null) => void;
}

function firstListId(lists: { id: string; sort_order: number }[]): string | undefined {
  const first = [...lists].sort((a, b) => a.sort_order - b.sort_order)[0];
  return first?.id;
}

export function TaskListView({
  view,
  selectedTaskId,
  onSelectTask,
  onVisibleTasksChange,
  quickAddInputRef,
}: TaskListViewProps) {
  const { me } = useApp();
  const lists = useLists();
  const tasks = useTasks();
  const [newTaskTitle, setNewTaskTitle] = useState('');

  const list = view.type === 'list' ? lists.find((l) => l.id === view.listId) : undefined;
  const title =
    view.type === 'list' ? (list?.name ?? '') : (SMART_LISTS.find((s) => s.key === view.key)?.label ?? '');
  const sortMode: ListSortMode = list?.sort_mode ?? 'due';

  const tasksInView = filterTasksForView(tasks, view);

  useEffect(() => {
    if (!onVisibleTasksChange) return;
    if (view.type === 'list') {
      onVisibleTasksChange(flattenTaskTree(buildTaskTree(tasksInView, sortMode)));
    } else {
      onVisibleTasksChange(sortTasks(tasksInView, sortMode).map((t) => t.id));
    }
  }, [view, tasksInView, sortMode, onVisibleTasksChange]);

  if (!me) return null;
  const userId = me.id;

  const canComplete = (taskId: string): boolean => {
    for (const t of tasks) {
      if (t.parent_id === taskId && t.completed_at === null) return false;
    }
    return true;
  };

  const toggleComplete = (taskId: string, completing: boolean) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    completeTask(userId, task, completing);
  };

  const targetListId = view.type === 'list' ? view.listId : firstListId(lists);

  const createTask = () => {
    const trimmed = newTaskTitle.trim();
    if (!trimmed || !targetListId) return;
    const siblings = tasks.filter((t) => t.list_id === targetListId && t.parent_id === null);
    const id = uuidv7();
    upsertTask(userId, id, { list_id: targetListId, title: trimmed, sort_order: nextSortOrder(siblings) });
    setNewTaskTitle('');
  };

  const changeSortMode = (mode: ListSortMode) => {
    if (view.type === 'list') upsertList(userId, view.listId, { sort_mode: mode });
  };

  if (view.type === 'list' && !list) {
    return <div className="flex-1 p-6 text-sm text-neutral-400">リストが見つかりません</div>;
  }

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800 md:px-6 md:py-4">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl">{title}</h1>
        {view.type === 'list' && (
          <select
            value={sortMode}
            onChange={(e) => changeSortMode(e.target.value as ListSortMode)}
            className="shrink-0 rounded border border-neutral-200 bg-transparent p-1 text-xs dark:border-neutral-700"
          >
            <option value="custom">カスタム</option>
            <option value="due">期限順</option>
            <option value="priority">優先度順</option>
            <option value="name">名前順</option>
          </select>
        )}
      </header>

      <div className="flex items-center gap-2 border-b border-neutral-100 px-6 py-3 dark:border-neutral-900">
        <input
          ref={quickAddInputRef}
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createTask();
          }}
          disabled={!targetListId}
          placeholder={targetListId ? '+ タスクを追加' : '先にリストを作成してください'}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {view.type === 'smart' && view.key === 'today' ? (
          <TodayViewSections
            tasks={tasksInView}
            sortMode={sortMode}
            canComplete={canComplete}
            onToggleComplete={toggleComplete}
            onSelect={onSelectTask}
            selectedTaskId={selectedTaskId}
          />
        ) : (
          <TaskTreeOrFlat
            view={view}
            tasks={tasksInView}
            sortMode={sortMode}
            canComplete={canComplete}
            onToggleComplete={toggleComplete}
            onSelect={onSelectTask}
            selectedTaskId={selectedTaskId}
          />
        )}
        {tasksInView.length === 0 && <p className="p-6 text-center text-sm text-neutral-400">タスクはありません</p>}
      </div>
    </div>
  );
}

interface SharedListProps {
  sortMode: ListSortMode;
  canComplete: (taskId: string) => boolean;
  onToggleComplete: (taskId: string, completing: boolean) => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
}

function TaskTreeOrFlat({
  view,
  tasks,
  sortMode,
  canComplete,
  onToggleComplete,
  onSelect,
  selectedTaskId,
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
            onToggleComplete={onToggleComplete}
            onSelect={onSelect}
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
          onToggleComplete={onToggleComplete}
          onSelect={onSelect}
          selectedTaskId={selectedTaskId}
        />
      ))}
    </>
  );
}

function TodayViewSections({ tasks, sortMode, canComplete, onToggleComplete, onSelect, selectedTaskId }: SharedListProps & { tasks: TaskRow[] }) {
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
              onToggleComplete={onToggleComplete}
              onSelect={onSelect}
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
              onToggleComplete={onToggleComplete}
              onSelect={onSelect}
              selectedTaskId={selectedTaskId}
            />
          ))}
        </div>
      )}
    </>
  );
}
