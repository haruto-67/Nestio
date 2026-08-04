import { useEffect, useState, type MouseEvent, type DragEvent } from 'react';
import { uuidv7, type ListSortMode, type TaskRow } from '@nestio/shared';
import { LayoutList, Kanban, CalendarDays } from 'lucide-react';
import { useApp } from '../../state/AppProvider.js';
import { useLists, useTasks } from '../../db/queries.js';
import type { ViewSelection } from '../../state/view.js';
import { filterTasksForView } from '../../lib/filter-tasks.js';
import { buildTaskTree, flattenTaskTreeWithDepth, type FlattenedTaskEntry } from '../../lib/task-tree.js';
import { sortTasks } from '../../lib/task-sort.js';
import { taskDueDateStringJst, SMART_LISTS, SMART_LIST_HEADER_ACCENT_CLASS } from '../../lib/task-views.js';
import { todayJstDateString } from '../../lib/datetime.js';
import { upsertTask, upsertList, completeTask } from '../../state/actions.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { showToast } from '../../ui/toast.js';
import { setTaskCollapsed } from '../../lib/collapsed-tasks.js';
import { useKeymap } from '../../state/useKeymap.js';
import { TaskItem } from './TaskItem.js';
import { EmptyState } from './EmptyState.js';
import { KanbanBoard } from './KanbanBoard.js';
import { CalendarBoard } from './CalendarBoard.js';

const PRIORITY_FILTER_LABELS: Record<number, string> = { 0: 'なし', 1: '低', 2: '中', 3: '高' };

type TaskDisplayMode = 'list' | 'kanban' | 'calendar';
const DISPLAY_MODE_KEY = 'nestio_task_display_mode';

function loadInitialDisplayMode(): TaskDisplayMode {
  const stored = localStorage.getItem(DISPLAY_MODE_KEY);
  return stored === 'kanban' || stored === 'calendar' ? stored : 'list';
}

interface TaskListViewProps {
  view: ViewSelection;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** サブタスク作成後にそのタスクを選択し、タイトル入力欄へ自動フォーカスさせる */
  onCreateAndSelectTask: (id: string) => void;
  onVisibleTasksChange?: (entries: FlattenedTaskEntry[]) => void;
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
  onCreateAndSelectTask,
  onVisibleTasksChange,
  quickAddInputRef,
}: TaskListViewProps) {
  const { me } = useApp();
  const lists = useLists();
  const tasks = useTasks();
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<number | 'all'>('all');
  const [displayMode, setDisplayModeState] = useState<TaskDisplayMode>(loadInitialDisplayMode);
  const setDisplayMode = (mode: TaskDisplayMode) => {
    setDisplayModeState(mode);
    localStorage.setItem(DISPLAY_MODE_KEY, mode);
  };
  const { keymap } = useKeymap();
  const listNameById = new Map(lists.map((l) => [l.id, l.name]));

  const list = view.type === 'list' ? lists.find((l) => l.id === view.listId) : undefined;
  const title =
    view.type === 'list' ? (list?.name ?? '') : (SMART_LISTS.find((s) => s.key === view.key)?.label ?? '');
  const sortMode: ListSortMode = list?.sort_mode ?? 'due';
  const headerAccentClass = view.type === 'smart' ? SMART_LIST_HEADER_ACCENT_CLASS[view.key] : 'border-t-transparent';

  const tasksInViewUnfiltered = filterTasksForView(tasks, view);
  const tasksInView =
    priorityFilter === 'all' ? tasksInViewUnfiltered : tasksInViewUnfiltered.filter((t) => t.priority === priorityFilter);

  useEffect(() => {
    if (!onVisibleTasksChange) return;
    if (view.type === 'list') {
      onVisibleTasksChange(flattenTaskTreeWithDepth(buildTaskTree(tasksInView, sortMode)));
    } else {
      onVisibleTasksChange(sortTasks(tasksInView, sortMode).map((t) => ({ id: t.id, depth: 0 })));
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

  const addSubtask = (parentTaskId: string) => {
    const parent = tasks.find((t) => t.id === parentTaskId);
    if (!parent) return;
    const id = uuidv7();
    const siblings = tasks.filter((t) => t.parent_id === parentTaskId);
    upsertTask(userId, id, {
      list_id: parent.list_id,
      parent_id: parentTaskId,
      title: '新しいサブタスク',
      sort_order: nextSortOrder(siblings),
    });
    onCreateAndSelectTask(id);
    showToast('サブタスクを追加しました');
  };

  const targetListId = view.type === 'list' ? view.listId : firstListId(lists);

  // タスクをドラッグして別のタスクの上にドロップ→そのタスクの子にする（indent操作と同じ意味）
  const dropOntoTask = (draggedTaskId: string, targetTaskId: string) => {
    const target = tasks.find((t) => t.id === targetTaskId);
    if (!target) return;
    const siblings = tasks.filter((t) => t.parent_id === targetTaskId);
    upsertTask(userId, draggedTaskId, {
      list_id: target.list_id,
      parent_id: targetTaskId,
      sort_order: nextSortOrder(siblings),
    });
    setTaskCollapsed(targetTaskId, false);
  };

  // タスクをドラッグしてタスク一覧の背景（行以外）にドロップ→現在のリストの最上位階層に戻す
  const dropToTopLevel = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('text/nestio-task-id')) return;
    e.preventDefault();
    const draggedTaskId = e.dataTransfer.getData('text/nestio-task-id');
    if (!draggedTaskId || !targetListId) return;
    const siblings = tasks.filter((t) => t.list_id === targetListId && t.parent_id === null);
    upsertTask(userId, draggedTaskId, {
      list_id: targetListId,
      parent_id: null,
      sort_order: nextSortOrder(siblings),
    });
  };

  const createTask = () => {
    const trimmed = newTaskTitle.trim();
    if (!trimmed || !targetListId) return;
    const siblings = tasks.filter((t) => t.list_id === targetListId && t.parent_id === null);
    const id = uuidv7();
    upsertTask(userId, id, { list_id: targetListId, title: trimmed, sort_order: nextSortOrder(siblings) });
    setNewTaskTitle('');
    onSelectTask(id);
    showToast('タスクを追加しました');
  };

  // カンバンビュー: カードを別の優先度列へドロップして優先度を変更する
  const changeTaskPriority = (taskId: string, priority: number) => {
    upsertTask(userId, taskId, { priority: priority as 0 | 1 | 2 | 3 });
  };

  // カレンダービュー: カードを日付セルへドロップしてその日の終日タスクにする
  // （due_at/due_dateは排他のためdue_atはnullにする。既存の時刻指定は失われる）
  const changeTaskDueDate = (taskId: string, dateStr: string) => {
    upsertTask(userId, taskId, { due_date: dateStr, due_at: null });
  };

  const changeSortMode = (mode: ListSortMode) => {
    if (view.type === 'list') upsertList(userId, view.listId, { sort_mode: mode });
  };

  if (view.type === 'list' && !list) {
    return <div className="flex-1 p-6 text-sm text-neutral-400">リストが見つかりません</div>;
  }

  // タスク詳細パネルが開いている時、タスク行以外のどこをクリックしても閉じる。
  // 行クリック（[data-task-row]）はそれ自体が選択操作なので除外する
  // （TaskItem内のチェックボックス等は個別にstopPropagationしているのでここには来ない）
  const closeDetailUnlessRowClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-task-row]')) return;
    onSelectTask(null);
  };

  return (
    <div
      className={`flex h-full flex-1 flex-col overflow-hidden border-t-4 ${headerAccentClass}`}
      onClick={closeDetailUnlessRowClick}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800 md:px-6 md:py-4">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl">{title}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded border border-neutral-200 dark:border-neutral-700">
            {(
              [
                { mode: 'list' as const, label: 'リスト', Icon: LayoutList },
                { mode: 'kanban' as const, label: 'カンバン', Icon: Kanban },
                { mode: 'calendar' as const, label: 'カレンダー', Icon: CalendarDays },
              ]
            ).map(({ mode, label, Icon }) => (
              <button
                key={mode}
                onClick={() => setDisplayMode(mode)}
                title={label}
                className={`flex min-h-8 min-w-8 items-center justify-center px-1.5 first:rounded-l last:rounded-r ${
                  displayMode === mode
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            title="優先度で絞り込み"
            className="rounded border border-neutral-200 bg-transparent p-1 text-xs dark:border-neutral-700"
          >
            <option value="all">すべての優先度</option>
            {([3, 2, 1, 0] as const).map((p) => (
              <option key={p} value={p}>
                優先度: {PRIORITY_FILTER_LABELS[p]}
              </option>
            ))}
          </select>
          {view.type === 'list' && (
            <select
              value={sortMode}
              onChange={(e) => changeSortMode(e.target.value as ListSortMode)}
              className="rounded border border-neutral-200 bg-transparent p-1 text-xs dark:border-neutral-700"
            >
              <option value="custom">カスタム</option>
              <option value="due">期限順</option>
              <option value="priority">優先度順</option>
              <option value="name">名前順</option>
            </select>
          )}
        </div>
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
        <kbd className="hidden shrink-0 rounded border border-neutral-200 px-1 py-0.5 text-[10px] text-neutral-400 md:inline dark:border-neutral-700">
          {keymap.quick_add}
        </kbd>
      </div>

      {displayMode === 'kanban' ? (
        <div className="min-h-0 flex-1">
          <KanbanBoard
            tasks={tasksInView}
            onToggleComplete={toggleComplete}
            onSelect={onSelectTask}
            selectedTaskId={selectedTaskId}
            onChangePriority={changeTaskPriority}
            listNameById={listNameById}
            showListName={view.type !== 'list'}
          />
        </div>
      ) : displayMode === 'calendar' ? (
        <div className="min-h-0 flex-1">
          <CalendarBoard
            tasks={tasksInView}
            onToggleComplete={toggleComplete}
            onSelect={onSelectTask}
            selectedTaskId={selectedTaskId}
            onChangeDueDate={changeTaskDueDate}
          />
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto px-2 py-2"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('text/nestio-task-id')) e.preventDefault();
          }}
          onDrop={dropToTopLevel}
        >
          {view.type === 'smart' && view.key === 'today' ? (
            <TodayViewSections
              tasks={tasksInView}
              sortMode={sortMode}
              canComplete={canComplete}
              onToggleComplete={toggleComplete}
              onSelect={onSelectTask}
              selectedTaskId={selectedTaskId}
              onAddSubtask={addSubtask}
              onDropOntoTask={dropOntoTask}
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
              onAddSubtask={addSubtask}
              onDropOntoTask={dropOntoTask}
            />
          )}
          {tasksInView.length === 0 && (
            <EmptyState
              message={
                priorityFilter !== 'all'
                  ? 'この優先度のタスクはありません'
                  : tasksInViewUnfiltered.length === 0
                    ? undefined
                    : 'タスクはありません'
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

interface SharedListProps {
  sortMode: ListSortMode;
  canComplete: (taskId: string) => boolean;
  onToggleComplete: (taskId: string, completing: boolean) => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
  onAddSubtask: (taskId: string) => void;
  onDropOntoTask: (draggedTaskId: string, targetTaskId: string) => void;
}

function TaskTreeOrFlat({
  view,
  tasks,
  sortMode,
  canComplete,
  onToggleComplete,
  onSelect,
  selectedTaskId,
  onAddSubtask,
  onDropOntoTask,
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
            onAddSubtask={onAddSubtask}
            onDropOntoTask={onDropOntoTask}
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
          onAddSubtask={onAddSubtask}
          onDropOntoTask={onDropOntoTask}
          selectedTaskId={selectedTaskId}
        />
      ))}
    </>
  );
}

function TodayViewSections({ tasks, sortMode, canComplete, onToggleComplete, onSelect, selectedTaskId, onAddSubtask, onDropOntoTask }: SharedListProps & { tasks: TaskRow[] }) {
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
              onAddSubtask={onAddSubtask}
              onDropOntoTask={onDropOntoTask}
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
              onAddSubtask={onAddSubtask}
              onDropOntoTask={onDropOntoTask}
              selectedTaskId={selectedTaskId}
            />
          ))}
        </div>
      )}
    </>
  );
}
