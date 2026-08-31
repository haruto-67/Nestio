import { useEffect, useState, type MouseEvent, type DragEvent } from 'react';
import { uuidv7, type ListSortMode } from '@nestio/shared';
import { Plus } from 'lucide-react';
import { useApp } from '../../state/AppProvider.js';
import { useLists, useTasks, useTags, useTaskTags } from '../../db/queries.js';
import type { ViewSelection } from '../../state/view.js';
import { filterTasksForView } from '../../lib/filter-tasks.js';
import { buildTaskTree, flattenTaskTreeWithDepth, type FlattenedTaskEntry } from '../../lib/task-tree.js';
import { sortTasks } from '../../lib/task-sort.js';
import { taskDueDateStringJst, SMART_LISTS, SMART_LIST_HEADER_ACCENT_CLASS } from '../../lib/task-views.js';
import { todayJstDateString } from '../../lib/datetime.js';
import { upsertTask, upsertList, completeTask, deleteTask } from '../../state/actions.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { showToast } from '../../ui/toast.js';
import { undo } from '../../state/undoManager.js';
import { setTaskCollapsed, isTaskCollapsed, subscribeAnyTaskCollapsed } from '../../lib/collapsed-tasks.js';
import { isCoarsePointerDevice } from '../../lib/pointer.js';
import { loadCustomViews, subscribeCustomViews } from '../../lib/custom-views.js';
import { useKeymap } from '../../state/useKeymap.js';
import { EmptyState } from './EmptyState.js';
import { KanbanBoard } from './KanbanBoard.js';
import { CalendarBoard } from './CalendarBoard.js';
import { TaskListFilterMenu } from './TaskListFilterMenu.js';
import { TaskListDisplayMenu, type TaskDisplayMode } from './TaskListDisplayMenu.js';
import { TaskTreeOrFlat, TodayViewSections } from './TaskListRows.js';

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
  /** trueの間、モバイル幅では一覧を隠して詳細パネルに画面を譲る。detailOpen（詳細パネルの
   * 開閉）で判定する必要があり、selectedTaskId（カーソル位置。詳細を開かないj/k移動でも
   * 立つ）で判定すると誤ってモバイルで一覧が消えてしまう（改修11回目フォローアップ：
   * モバイルで詳細を開くと一覧と詳細が半々に潰れて事実上開けなかった不具合の修正） */
  detailOpen?: boolean;
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
  detailOpen = false,
}: TaskListViewProps) {
  // selectedTaskIdはPC向けのj/kカーソル位置を兼ねるため、詳細パネルを閉じても保持され続ける
  // （キーボードナビゲーションの基準点として必要）。しかしタッチ端末ではカーソル移動の概念が
  // 無く、タスク詳細を閉じた後もタップした行にだけ青いハイライトが残り続けているように
  // 見えてしまう（改修16回目）。タッチ端末では詳細パネルが実際に開いている間だけハイライトする
  const highlightedTaskId = detailOpen || !isCoarsePointerDevice() ? selectedTaskId : null;
  const { me } = useApp();
  const lists = useLists();
  const tasks = useTasks();
  const allTags = useTags();
  const taskTags = useTaskTags();
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<number | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // ヘッダーを「絞り込み」「表示方法」の2アイコンに集約（改修9回目）。開いているメニューを
  // 1つのstateで管理し、片方を開いたらもう片方は自動的に閉じる（改修13回目：
  // TaskListFilterMenu/TaskListDisplayMenuへの切り出しに伴い、開閉状態のみ親で持つ形にした）
  const [activeMenu, setActiveMenu] = useState<'filter' | 'display' | null>(null);
  const [customViews, setCustomViewsState] = useState(() => loadCustomViews());
  useEffect(() => subscribeCustomViews(() => setCustomViewsState(loadCustomViews())), []);
  const [displayMode, setDisplayModeState] = useState<TaskDisplayMode>(loadInitialDisplayMode);
  const setDisplayMode = (mode: TaskDisplayMode) => {
    setDisplayModeState(mode);
    localStorage.setItem(DISPLAY_MODE_KEY, mode);
  };
  const { keymap } = useKeymap();
  const listNameById = new Map(lists.map((l) => [l.id, l.name]));

  const list = view.type === 'list' ? lists.find((l) => l.id === view.listId) : undefined;
  const customView = view.type === 'custom' ? customViews.find((v) => v.id === view.id) : undefined;
  const title =
    view.type === 'list'
      ? (list?.name ?? '')
      : view.type === 'custom'
        ? (customView?.name ?? '')
        : (SMART_LISTS.find((s) => s.key === view.key)?.label ?? '');
  const sortMode: ListSortMode = list?.sort_mode ?? 'due';
  const headerAccentClass = view.type === 'smart' ? SMART_LIST_HEADER_ACCENT_CLASS[view.key] : 'border-t-transparent';

  // 「今日」ビューだけの達成率表示（改修13回目：他のスマートビューと見た目が同じで
  // 「今日」の特別感が無いという指摘への対応）。filterTasksForViewの'today'は未完了のみを
  // 返すため、完了数は別途「期限が今日以前」の全タスクから集計する
  const todayCompletionStats =
    view.type === 'smart' && view.key === 'today'
      ? (() => {
          const today = todayJstDateString();
          const relevant = tasks.filter((t) => {
            const d = taskDueDateStringJst(t);
            return d !== null && d <= today;
          });
          return { completed: relevant.filter((t) => t.completed_at !== null).length, total: relevant.length };
        })()
      : null;

  const tagIdsByTaskId = new Map<string, string[]>();
  for (const tt of taskTags) {
    const bucket = tagIdsByTaskId.get(tt.task_id);
    if (bucket) bucket.push(tt.tag_id);
    else tagIdsByTaskId.set(tt.task_id, [tt.tag_id]);
  }

  // カスタムビューが要求するタグ条件に、インタラクティブなタグ絞り込みを追加でAND適用する
  const effectiveTagFilter = [...new Set([...(customView?.tagIds ?? []), ...tagFilter])];

  const tasksInViewUnfiltered = filterTasksForView(tasks, view);
  const tasksInViewByPriority =
    priorityFilter === 'all' ? tasksInViewUnfiltered : tasksInViewUnfiltered.filter((t) => t.priority === priorityFilter);
  const tasksInView =
    effectiveTagFilter.length === 0
      ? tasksInViewByPriority
      : tasksInViewByPriority.filter((t) => {
          const taskTagIds = tagIdsByTaskId.get(t.id) ?? [];
          return effectiveTagFilter.every((tagId) => taskTagIds.includes(tagId));
        });

  // 折りたたみ状態はDexieではなくlocalStorageで管理しているため、tasksInView等の変化だけでは
  // 再計算のきっかけにならない。折りたたみが変わるたびに強制的に再計算する（改修8回目）
  const [collapsedVersion, setCollapsedVersion] = useState(0);
  useEffect(() => subscribeAnyTaskCollapsed(() => setCollapsedVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!onVisibleTasksChange) return;
    if (view.type === 'list') {
      onVisibleTasksChange(flattenTaskTreeWithDepth(buildTaskTree(tasksInView, sortMode), isTaskCollapsed));
    } else {
      onVisibleTasksChange(sortTasks(tasksInView, sortMode).map((t) => ({ id: t.id, depth: 0 })));
    }
  }, [view, tasksInView, sortMode, onVisibleTasksChange, collapsedVersion]);

  if (!me) return null;
  const userId = me.id;

  const canComplete = (taskId: string): boolean => {
    for (const t of tasks) {
      if (t.parent_id === taskId && t.completed_at === null) return false;
    }
    return true;
  };

  // 先行タスク（軽量な依存関係、改修13回目）：先行タスクがまだ未完了なら、その
  // タイトルを返す（一覧でグレーアウトする材料にする）。tasksは既に論理削除済みを
  // 除外しているため、削除された先行タスクは見つからず自動的にブロック扱いから外れる
  const predecessorTitle = (taskId: string): string | null => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.blocked_by_task_id === null) return null;
    const predecessor = tasks.find((t) => t.id === task.blocked_by_task_id);
    if (!predecessor || predecessor.completed_at !== null) return null;
    return predecessor.title;
  };

  const toggleComplete = (taskId: string, completing: boolean) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    completeTask(userId, task, completing);
  };

  const setPriority = (taskId: string, priority: 0 | 1 | 2 | 3) => {
    upsertTask(userId, taskId, { priority });
  };

  // モバイルのスワイプ削除（改修13回目）：誤操作時の安心感のため「元に戻す」ボタン付きトーストを出す
  const handleSwipeDelete = (taskId: string) => {
    deleteTask(taskId);
    showToast('削除しました', { onUndo: undo });
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
  if (view.type === 'custom' && !customView) {
    return <div className="flex-1 p-6 text-sm text-neutral-400">カスタムビューが見つかりません</div>;
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
      // モバイルで詳細パネルを開いた時も一覧をdisplay:noneにせず裏に表示したままにする
      // （改修21回目フォローアップ：以前はアニメーション終了後にhidden md:flexへ切り替えており、
      // TaskDetailArea側が意図的に空けている左端の隙間から覗けるはずの一覧が結局消えてしまい
      // 「一瞬画面が暗くなる」不具合になっていた。詳細パネルはz-40のfixedオーバーレイなので
      // 覆われている部分は元々クリックされない。常時表示にして裏の一覧を透けて見せ続ける）
      className={`flex h-full flex-1 flex-col overflow-hidden border-t-4 ${headerAccentClass}`}
      onClick={closeDetailUnlessRowClick}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800 md:px-6 md:py-4">
        <h1 className="flex min-w-0 flex-1 items-baseline gap-2 truncate text-lg font-semibold md:text-xl">
          {title}
          {todayCompletionStats && todayCompletionStats.total > 0 && (
            <span className="shrink-0 text-sm font-normal text-amber-500">
              {todayCompletionStats.completed}/{todayCompletionStats.total} 完了
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <TaskListFilterMenu
            open={activeMenu === 'filter'}
            onToggle={() => setActiveMenu((m) => (m === 'filter' ? null : 'filter'))}
            onClose={() => setActiveMenu((m) => (m === 'filter' ? null : m))}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            allTags={allTags}
            tagFilter={tagFilter}
            onTagFilterChange={setTagFilter}
          />
          <TaskListDisplayMenu
            open={activeMenu === 'display'}
            onToggle={() => setActiveMenu((m) => (m === 'display' ? null : 'display'))}
            onClose={() => setActiveMenu((m) => (m === 'display' ? null : m))}
            displayMode={displayMode}
            onChangeDisplayMode={setDisplayMode}
            showSortMode={view.type === 'list'}
            sortMode={sortMode}
            onChangeSortMode={changeSortMode}
          />
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-neutral-100 px-6 py-3 dark:border-neutral-900">
        <input
          ref={quickAddInputRef}
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => {
            // IME変換確定のEnterと入力確定のEnterを区別する（日本語入力中に変換確定しただけで
            // タスクが作成されてしまい、変換中だった文字が入力欄に残ってしまう不具合の修正。改修8回目）
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) createTask();
          }}
          disabled={!targetListId}
          placeholder={targetListId ? '+ タスクを追加' : '先にリストを作成してください'}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
        />
        <kbd className="hidden shrink-0 rounded-md border border-neutral-200 px-1 py-0.5 text-[10px] text-neutral-400 md:inline dark:border-neutral-700">
          {keymap.quick_add}
        </kbd>
        {/* PCではEnterでの作成が分かりやすいが、スマホではEnter確定が直感的でないという
            指摘（改修14回目）を受け、明示的な追加ボタンを常設した。stopPropagationが無いと
            クリックが外側divのcloseDetailUnlessRowClickへバブリングし、createTask直後に
            選択したタスクの詳細パネルが即座に閉じてしまう */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            createTask();
          }}
          disabled={!targetListId || newTaskTitle.trim() === ''}
          title="タスクを追加"
          className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 disabled:opacity-30 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <Plus size={18} />
        </button>
      </div>

      {displayMode === 'kanban' ? (
        <div className="min-h-0 flex-1">
          <KanbanBoard
            tasks={tasksInView}
            onToggleComplete={toggleComplete}
            onSelect={onSelectTask}
            selectedTaskId={highlightedTaskId}
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
            selectedTaskId={highlightedTaskId}
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
              predecessorTitle={predecessorTitle}
              onToggleComplete={toggleComplete}
              onSelect={onSelectTask}
              selectedTaskId={highlightedTaskId}
              onAddSubtask={addSubtask}
              onDropOntoTask={dropOntoTask}
              onDelete={handleSwipeDelete}
              onSetPriority={setPriority}
            />
          ) : (
            <TaskTreeOrFlat
              view={view}
              tasks={tasksInView}
              sortMode={sortMode}
              canComplete={canComplete}
              predecessorTitle={predecessorTitle}
              onToggleComplete={toggleComplete}
              onSelect={onSelectTask}
              selectedTaskId={highlightedTaskId}
              onAddSubtask={addSubtask}
              onDropOntoTask={dropOntoTask}
              onDelete={handleSwipeDelete}
              onSetPriority={setPriority}
            />
          )}
          {tasksInView.length === 0 && (
            <EmptyState
              view={view}
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
