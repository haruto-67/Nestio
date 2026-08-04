import { useCallback, useEffect, useRef, useState } from 'react';
import { uuidv7 } from '@nestio/shared';
import { Menu, Timer, Search, Egg, HelpCircle, Trash2, Settings } from 'lucide-react';
import { AppProvider, useApp } from './state/AppProvider.js';
import { useTasks } from './db/queries.js';
import { ToastContainer } from './ui/ToastContainer.js';
import { showToast } from './ui/toast.js';
import { useResizableWidth } from './lib/useResizableWidth.js';
import { LoginScreen } from './features/auth/LoginScreen.js';
import { Sidebar } from './features/tree/Sidebar.js';
import { TaskListView } from './features/tasks/TaskListView.js';
import { TaskDetailPanel } from './features/tasks/TaskDetailPanel.js';
import { useTheme } from './state/useTheme.js';
import { useKeymap } from './state/useKeymap.js';
import type { ViewSelection } from './state/view.js';
import { useKeyboardShortcuts } from './features/keyboard/useKeyboardShortcuts.js';
import { ShortcutHelpModal } from './features/keyboard/ShortcutHelpModal.js';
import { KeymapSettings } from './features/keyboard/KeymapSettings.js';
import { SearchModal } from './features/search/SearchModal.js';
import { NotesScreen } from './features/notes/NotesScreen.js';
import { PomodoroTimer } from './features/pomodoro/PomodoroTimer.js';
import { HatchSettings } from './features/hatch/HatchSettings.js';
import { TrashView } from './features/trash/TrashView.js';
import { upsertTask, deleteTask, completeTask } from './state/actions.js';
import { nextSortOrder } from './lib/sort-order.js';

type Screen = 'tasks' | 'notes';

export function App() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}

function Root() {
  const { me, loading } = useApp();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">読み込み中...</div>
    );
  }
  if (!me) {
    return <LoginScreen />;
  }
  return <MainLayout />;
}

function MainLayout() {
  const { me } = useApp();
  const tasks = useTasks();
  const [screen, setScreen] = useState<Screen>('tasks');
  const [view, setView] = useState<ViewSelection>({ type: 'smart', key: 'today' });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showKeymapSettings, setShowKeymapSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showPomodoro, setShowPomodoro] = useState(false);
  const [showHatchSettings, setShowHatchSettings] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { keymap } = useKeymap();
  const sidebarResize = useResizableWidth('nestio_sidebar_width', 256, 200, 480);
  const visibleTaskIdsRef = useRef<string[]>([]);
  const quickAddInputElRef = useRef<HTMLInputElement | null>(null);

  const selectView = (v: ViewSelection) => {
    setView(v);
    setSelectedTaskId(null);
    setDrawerOpen(false);
  };

  const handleVisibleTasksChange = useCallback((ids: string[]) => {
    visibleTaskIdsRef.current = ids;
  }, []);

  const moveSelection = (delta: number) => {
    const ids = visibleTaskIdsRef.current;
    if (ids.length === 0) return;
    const idx = selectedTaskId ? ids.indexOf(selectedTaskId) : -1;
    const nextIdx = Math.min(Math.max(idx + delta, 0), ids.length - 1);
    setSelectedTaskId(ids[nextIdx] ?? null);
  };

  const findTask = (id: string) => tasks.find((t) => t.id === id);

  const indentSelected = () => {
    if (!selectedTaskId || !me || view.type !== 'list') return;
    const ids = visibleTaskIdsRef.current;
    const idx = ids.indexOf(selectedTaskId);
    if (idx <= 0) return;
    const newParentId = ids[idx - 1];
    if (!newParentId) return;
    const siblings = tasks.filter((t) => t.parent_id === newParentId);
    upsertTask(me.id, selectedTaskId, { parent_id: newParentId, sort_order: nextSortOrder(siblings) });
  };

  const outdentSelected = () => {
    if (!selectedTaskId || !me) return;
    const task = findTask(selectedTaskId);
    if (!task || !task.parent_id) return;
    const grandParentId = findTask(task.parent_id)?.parent_id ?? null;
    upsertTask(me.id, selectedTaskId, { parent_id: grandParentId });
  };

  const addSubtaskToSelected = () => {
    if (!selectedTaskId || !me) return;
    const parent = findTask(selectedTaskId);
    if (!parent) return;
    const id = uuidv7();
    const siblings = tasks.filter((t) => t.parent_id === selectedTaskId);
    upsertTask(me.id, id, {
      list_id: parent.list_id,
      parent_id: selectedTaskId,
      title: '新しいサブタスク',
      sort_order: nextSortOrder(siblings),
    });
    setSelectedTaskId(id);
    showToast('サブタスクを追加しました');
  };

  const addSiblingSubtaskToSelected = () => {
    if (!selectedTaskId || !me) return;
    const current = findTask(selectedTaskId);
    if (!current) return;
    const id = uuidv7();
    const siblings = tasks.filter((t) => t.parent_id === current.parent_id);
    upsertTask(me.id, id, {
      list_id: current.list_id,
      parent_id: current.parent_id,
      title: '新しいタスク',
      sort_order: nextSortOrder(siblings),
    });
    setSelectedTaskId(id);
    showToast('タスクを追加しました');
  };

  // Escapeは現在開いている一番手前のパネル/モーダルを1つだけ閉じる
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (showSearch) return setShowSearch(false);
      if (showPomodoro) return setShowPomodoro(false);
      if (showTrash) return setShowTrash(false);
      if (showHatchSettings) return setShowHatchSettings(false);
      if (showKeymapSettings) return setShowKeymapSettings(false);
      if (showHelp) return setShowHelp(false);
      if (drawerOpen) return setDrawerOpen(false);
      if (selectedTaskId) return setSelectedTaskId(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showSearch, showPomodoro, showTrash, showHatchSettings, showKeymapSettings, showHelp, drawerOpen, selectedTaskId]);

  useKeyboardShortcuts(keymap, {
    onQuickAdd: () => quickAddInputElRef.current?.focus(),
    onSearch: () => setShowSearch(true),
    onToggleComplete: () => {
      if (!selectedTaskId || !me) return;
      const task = findTask(selectedTaskId);
      if (!task) return;
      completeTask(me.id, task, task.completed_at === null);
    },
    onDelete: () => {
      if (!selectedTaskId) return;
      deleteTask(selectedTaskId);
      setSelectedTaskId(null);
      showToast('削除しました');
    },
    onSetPriority: (p) => {
      if (!selectedTaskId || !me) return;
      upsertTask(me.id, selectedTaskId, { priority: p });
    },
    onToggleTheme: toggleTheme,
    onShowHelp: () => setShowHelp(true),
    onGotoToday: () => selectView({ type: 'smart', key: 'today' }),
    onMoveUp: () => moveSelection(-1),
    onMoveDown: () => moveSelection(1),
    onIndent: indentSelected,
    onOutdent: outdentSelected,
    onAddSubtask: addSubtaskToSelected,
    onAddSiblingSubtask: addSiblingSubtaskToSelected,
  });

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-900 dark:text-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800 md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          title="メニュー"
          className="flex min-h-11 min-w-11 items-center justify-center"
        >
          <Menu size={26} />
        </button>
        <span className="text-sm font-semibold">Nestio</span>
        <div className="flex gap-1">
          <button
            onClick={() => setShowPomodoro(true)}
            title="ポモドーロ"
            className="flex min-h-11 min-w-11 items-center justify-center text-red-500"
          >
            <Timer size={18} />
          </button>
          <button
            onClick={() => setShowSearch(true)}
            title="検索"
            className="flex min-h-11 min-w-11 items-center justify-center text-blue-500"
          >
            <Search size={18} />
          </button>
          <button
            onClick={() => setShowHatchSettings(true)}
            title="Hatch設定"
            className="flex min-h-11 min-w-11 items-center justify-center text-amber-500"
          >
            <Egg size={18} />
          </button>
          <button
            onClick={() => setShowHelp(true)}
            title="ショートカット一覧"
            className="flex min-h-11 min-w-11 items-center justify-center text-neutral-400"
          >
            <HelpCircle size={18} />
          </button>
          <button
            onClick={() => setShowKeymapSettings(true)}
            title="設定"
            className="flex min-h-11 min-w-11 items-center justify-center text-neutral-400"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className="relative hidden shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800 md:flex"
          style={{ width: sidebarResize.width }}
        >
          <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
            <span className="text-sm font-semibold">Nestio</span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPomodoro(true)}
                title="ポモドーロ"
                className="text-red-500 hover:text-red-600"
              >
                <Timer size={16} />
              </button>
              <button
                onClick={() => setShowSearch(true)}
                title="検索"
                className="text-blue-500 hover:text-blue-600"
              >
                <Search size={16} />
              </button>
              <button
                onClick={() => setShowHatchSettings(true)}
                title="Hatch設定"
                className="text-amber-500 hover:text-amber-600"
              >
                <Egg size={16} />
              </button>
              <button
                onClick={() => setShowHelp(true)}
                title="ショートカット一覧（?）"
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <HelpCircle size={16} />
              </button>
              <button
                onClick={() => setShowTrash(true)}
                title="ゴミ箱"
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={() => setShowKeymapSettings(true)}
                title="設定"
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <Settings size={16} />
              </button>
            </div>
          </div>
          <div className="flex border-b border-neutral-200 text-sm dark:border-neutral-800">
            <button
              onClick={() => setScreen('tasks')}
              className={`flex-1 py-2 ${screen === 'tasks' ? 'border-b-2 border-blue-500 font-medium' : 'text-neutral-400'}`}
            >
              タスク
            </button>
            <button
              onClick={() => setScreen('notes')}
              className={`flex-1 py-2 ${screen === 'notes' ? 'border-b-2 border-blue-500 font-medium' : 'text-neutral-400'}`}
            >
              メモ
            </button>
          </div>
          {screen === 'tasks' && <Sidebar view={view} onSelectView={selectView} />}
          <div
            onMouseDown={(e) => sidebarResize.startResize(1)(e)}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-400/40"
          />
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div className="animate-[nestio-fade-scale-in_150ms_ease-out] flex w-72 flex-col bg-white dark:bg-neutral-900">
              <div className="flex border-b border-neutral-200 text-sm dark:border-neutral-800">
                <button
                  onClick={() => setScreen('tasks')}
                  className={`flex-1 py-2 ${screen === 'tasks' ? 'border-b-2 border-blue-500 font-medium' : 'text-neutral-400'}`}
                >
                  タスク
                </button>
                <button
                  onClick={() => setScreen('notes')}
                  className={`flex-1 py-2 ${screen === 'notes' ? 'border-b-2 border-blue-500 font-medium' : 'text-neutral-400'}`}
                >
                  メモ
                </button>
                <button
                  onClick={() => setShowTrash(true)}
                  title="ゴミ箱"
                  className="flex min-h-11 min-w-11 items-center justify-center text-neutral-400"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={() => setShowKeymapSettings(true)}
                  title="設定"
                  className="flex min-h-11 min-w-11 items-center justify-center text-neutral-400"
                >
                  <Settings size={16} />
                </button>
              </div>
              {screen === 'tasks' && <Sidebar view={view} onSelectView={selectView} />}
            </div>
            <div className="nestio-overlay flex-1 bg-black/40" onClick={() => setDrawerOpen(false)} />
          </div>
        )}

        {screen === 'tasks' ? (
          <>
            <TaskListView
              view={view}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
              onVisibleTasksChange={handleVisibleTasksChange}
              quickAddInputRef={(el) => {
                quickAddInputElRef.current = el;
              }}
            />
            {selectedTaskId && (
              <TaskDetailPanel
                taskId={selectedTaskId}
                onClose={() => setSelectedTaskId(null)}
                onMoveUp={() => moveSelection(-1)}
                onMoveDown={() => moveSelection(1)}
                onIndent={indentSelected}
                onOutdent={outdentSelected}
                onSelectTask={setSelectedTaskId}
              />
            )}
          </>
        ) : (
          <NotesScreen />
        )}
      </div>

      {showHelp && (
        <ShortcutHelpModal
          onClose={() => setShowHelp(false)}
          onOpenSettings={() => {
            setShowHelp(false);
            setShowKeymapSettings(true);
          }}
        />
      )}
      {showKeymapSettings && (
        <KeymapSettings theme={theme} onToggleTheme={toggleTheme} onClose={() => setShowKeymapSettings(false)} />
      )}
      {showHatchSettings && <HatchSettings onClose={() => setShowHatchSettings(false)} />}
      {showPomodoro && <PomodoroTimer onClose={() => setShowPomodoro(false)} />}
      {showTrash && <TrashView onClose={() => setShowTrash(false)} />}
      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onSelectTask={(taskId, listId) => {
            selectView({ type: 'list', listId });
            setSelectedTaskId(taskId);
          }}
        />
      )}
      <ToastContainer />
    </div>
  );
}
