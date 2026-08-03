import { useCallback, useRef, useState } from 'react';
import { AppProvider, useApp } from './state/AppProvider.js';
import { useTasks } from './db/queries.js';
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
  const { theme, toggleTheme } = useTheme();
  const { keymap } = useKeymap();
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
    onIndent: () => {
      if (!selectedTaskId || !me || view.type !== 'list') return;
      const ids = visibleTaskIdsRef.current;
      const idx = ids.indexOf(selectedTaskId);
      if (idx <= 0) return;
      const newParentId = ids[idx - 1];
      if (!newParentId) return;
      const siblings = tasks.filter((t) => t.parent_id === newParentId);
      upsertTask(me.id, selectedTaskId, { parent_id: newParentId, sort_order: nextSortOrder(siblings) });
    },
    onOutdent: () => {
      if (!selectedTaskId || !me) return;
      const task = findTask(selectedTaskId);
      if (!task || !task.parent_id) return;
      const grandParentId = findTask(task.parent_id)?.parent_id ?? null;
      upsertTask(me.id, selectedTaskId, { parent_id: grandParentId });
    },
  });

  return (
    <div className="flex h-screen flex-col bg-white text-neutral-900 dark:bg-neutral-900 dark:text-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800 md:hidden">
        <button onClick={() => setDrawerOpen(true)} className="text-sm">
          ☰ メニュー
        </button>
        <span className="text-sm font-semibold">Nestio</span>
        <div className="flex gap-3">
          <button onClick={() => setShowSearch(true)} title="検索" className="text-sm">
            🔍
          </button>
          <button onClick={toggleTheme} className="text-sm">
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden w-64 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800 md:flex">
          <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
            <span className="text-sm font-semibold">Nestio</span>
            <div className="flex gap-2">
              <button onClick={() => setShowSearch(true)} title="検索" className="text-sm">
                🔍
              </button>
              <button onClick={toggleTheme} title="テーマ切替" className="text-sm">
                {theme === 'dark' ? '🌙' : '☀️'}
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
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div className="flex w-72 flex-col bg-white dark:bg-neutral-900">
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
            </div>
            <div className="flex-1 bg-black/40" onClick={() => setDrawerOpen(false)} />
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
            {selectedTaskId && <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />}
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
      {showKeymapSettings && <KeymapSettings onClose={() => setShowKeymapSettings(false)} />}
      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onSelectTask={(taskId, listId) => {
            selectView({ type: 'list', listId });
            setSelectedTaskId(taskId);
          }}
        />
      )}
    </div>
  );
}
