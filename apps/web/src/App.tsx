import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';
import { uuidv7 } from '@nestio/shared';
import { Menu, Search, Egg, Keyboard, Trash2, Settings, ShieldCheck } from 'lucide-react';
import { AppProvider, useApp } from './state/AppProvider.js';
import { useTasks, useLists } from './db/queries.js';
import { SMART_LISTS } from './lib/task-views.js';
import { loadCustomViews, subscribeCustomViews } from './lib/custom-views.js';
import { ToastContainer } from './ui/ToastContainer.js';
import { PushPermissionPrompt } from './ui/PushPermissionPrompt.js';
import { showToast } from './ui/toast.js';
import { useResizableWidth } from './lib/useResizableWidth.js';
import { EDGE_SWIPE_ZONE_PX } from './lib/edge-swipe.js';
import { LoginScreen } from './features/auth/LoginScreen.js';
import { Sidebar, type SidebarHandle } from './features/tree/Sidebar.js';
import { TaskListView } from './features/tasks/TaskListView.js';
import { TaskDetailArea } from './features/tasks/TaskDetailArea.js';
import { useTheme } from './state/useTheme.js';
import { useKeymap } from './state/useKeymap.js';
import type { ViewSelection } from './state/view.js';
import { useKeyboardShortcuts } from './features/keyboard/useKeyboardShortcuts.js';
import { ShortcutHelpModal } from './features/keyboard/ShortcutHelpModal.js';
import { KeymapSettings } from './features/keyboard/KeymapSettings.js';
import { SearchModal } from './features/search/SearchModal.js';
import { NotesScreen, type NotesScreenHandle } from './features/notes/NotesScreen.js';
import { NotesColorFilter } from './features/notes/NotesColorFilter.js';
import { PomodoroTimer } from './features/pomodoro/PomodoroTimer.js';
import { PomodoroHeaderButton } from './features/pomodoro/PomodoroHeaderButton.js';
import { HatchSettings } from './features/hatch/HatchSettings.js';
import { AdminPanel } from './features/admin/AdminPanel.js';
import { TrashView } from './features/trash/TrashView.js';
import { WeeklyReview } from './features/tasks/WeeklyReview.js';
import { upsertTask, deleteTask, completeTask } from './state/actions.js';
import { nextSortOrder } from './lib/sort-order.js';
import { undo, redo } from './state/undoManager.js';
import type { FlattenedTaskEntry } from './lib/task-tree.js';
import { setTaskCollapsed, isTaskCollapsed } from './lib/collapsed-tasks.js';
import { listHatchRuns } from './api/hatch.js';
import { SyncStatusIndicator } from './ui/SyncStatusIndicator.js';

type Screen = 'tasks' | 'notes';

const LAST_SCREEN_KEY = 'nestio_last_screen';
const LAST_VIEW_KEY = 'nestio_last_view';

function loadInitialScreen(): Screen {
  const stored = localStorage.getItem(LAST_SCREEN_KEY);
  return stored === 'notes' ? 'notes' : 'tasks';
}

function loadInitialView(): ViewSelection {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY);
    if (!raw) return { type: 'smart', key: 'today' };
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      ('type' in parsed
        ? ['smart', 'list', 'custom'].includes((parsed as { type: unknown }).type as string)
        : false)
    ) {
      return parsed as ViewSelection;
    }
  } catch {
    // 壊れた保存値は無視してデフォルトへ
  }
  return { type: 'smart', key: 'today' };
}

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
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">
        読み込み中...
      </div>
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
  const lists = useLists();
  const [screen, setScreenState] = useState<Screen>(loadInitialScreen);
  const [view, setViewState] = useState<ViewSelection>(loadInitialView);
  const [customViews, setCustomViewsForTitle] = useState(() => loadCustomViews());
  useEffect(() => subscribeCustomViews(() => setCustomViewsForTitle(loadCustomViews())), []);

  // ブラウザタブのタイトルを現在のビューに合わせて動的に更新する（改修6回目）
  useEffect(() => {
    if (screen === 'notes') {
      document.title = 'Nestio - メモ';
      return;
    }
    let label = '';
    if (view.type === 'smart') label = SMART_LISTS.find((s) => s.key === view.key)?.label ?? '';
    else if (view.type === 'list') label = lists.find((l) => l.id === view.listId)?.name ?? '';
    else label = customViews.find((v) => v.id === view.id)?.name ?? '';
    document.title = label ? `Nestio - ${label}` : 'Nestio';
  }, [screen, view, lists, customViews]);

  const setScreen = (s: Screen) => {
    setScreenState(s);
    localStorage.setItem(LAST_SCREEN_KEY, s);
  };
  const setView = (v: ViewSelection) => {
    setViewState(v);
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(v));
  };
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // selectedTaskIdは「カーソル(j/kでの選択位置)」、detailOpenは「詳細パネルが開いているか」を
  // 別々に持つ。以前はこの2つが同じ状態だったため、詳細を閉じる/Escで抜けるとカーソルも
  // 消えてしまい、そこからj/kで移動を再開できなかった（改修10回目のフィードバック対応）
  const [detailOpen, setDetailOpen] = useState(false);
  const [focusTitleTaskId, setFocusTitleTaskId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showKeymapSettings, setShowKeymapSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showPomodoro, setShowPomodoro] = useState(false);
  const [showHatchSettings, setShowHatchSettings] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const [notesColorFilter, setNotesColorFilter] = useState<string | null>(null);
  // 左側エリア（サイドバー）へキーボードフォーカスを移す機能（改修10回目）。
  // trueの間はj/k・Enterがタスク一覧ではなくサイドバーのツリー移動に使われる
  const [sidebarFocused, setSidebarFocused] = useState(false);
  // メモ詳細(NoteEditor)が開いているか。NotesScreen内部で管理しているselectedNoteIdを
  // Escの一括クローズ処理から参照するために持つ（改修11回目）
  const [notesEditorOpen, setNotesEditorOpen] = useState(false);
  const sidebarRef = useRef<SidebarHandle>(null);
  const notesRef = useRef<NotesScreenHandle>(null);
  const { theme, toggleTheme } = useTheme();
  const { keymap } = useKeymap();
  const sidebarResize = useResizableWidth('nestio_sidebar_width', 256, 160, 900);
  const visibleTaskEntriesRef = useRef<FlattenedTaskEntry[]>([]);
  const quickAddInputElRef = useRef<HTMLInputElement | null>(null);

  const selectView = (v: ViewSelection) => {
    setView(v);
    setSelectedTaskId(null);
    setDetailOpen(false);
    setDrawerOpen(false);
  };

  // モバイルで画面左端から右へスワイプするとドロワーを開く（改修13回目：左上のメニュー
  // タップだけだと操作しづらいという要望）。タスク行のスワイプ完了/削除（TaskItem.tsx）とは
  // 開始位置が画面端24px以内かどうかで区別するため競合しない
  const edgeSwipeStartXRef = useRef<number | null>(null);
  const EDGE_SWIPE_OPEN_THRESHOLD_PX = 60;
  const handleEdgeSwipeStart = (e: ReactTouchEvent) => {
    const touch = e.touches[0];
    if (!touch || drawerOpen || touch.clientX > EDGE_SWIPE_ZONE_PX) {
      edgeSwipeStartXRef.current = null;
      return;
    }
    edgeSwipeStartXRef.current = touch.clientX;
  };
  const handleEdgeSwipeMove = (e: ReactTouchEvent) => {
    if (edgeSwipeStartXRef.current === null) return;
    const touch = e.touches[0];
    if (!touch) return;
    if (touch.clientX - edgeSwipeStartXRef.current > EDGE_SWIPE_OPEN_THRESHOLD_PX) {
      setDrawerOpen(true);
      edgeSwipeStartXRef.current = null;
    }
  };
  const handleEdgeSwipeEnd = () => {
    edgeSwipeStartXRef.current = null;
  };

  const handleVisibleTasksChange = useCallback((entries: FlattenedTaskEntry[]) => {
    visibleTaskEntriesRef.current = entries;
  }, []);

  const moveSelection = (delta: number) => {
    const entries = visibleTaskEntriesRef.current;
    if (entries.length === 0) return;
    const idx = selectedTaskId ? entries.findIndex((e) => e.id === selectedTaskId) : -1;
    const nextIdx = Math.min(Math.max(idx + delta, 0), entries.length - 1);
    setSelectedTaskId(entries[nextIdx]?.id ?? null);
  };

  const gotoFirstTask = () => {
    const entries = visibleTaskEntriesRef.current;
    setSelectedTaskId(entries[0]?.id ?? null);
  };
  const gotoLastTask = () => {
    const entries = visibleTaskEntriesRef.current;
    setSelectedTaskId(entries[entries.length - 1]?.id ?? null);
  };

  // タスク一覧でのタイプアヘッド（頭文字ジャンプ）。同じ文字を連続で押すと次の候補へ循環する（改修11回目）
  const typeaheadTask = (char: string) => {
    const entries = visibleTaskEntriesRef.current;
    if (entries.length === 0) return;
    const lower = char.toLowerCase();
    const currentIdx = selectedTaskId ? entries.findIndex((e) => e.id === selectedTaskId) : -1;
    const matches = entries
      .map((e, i) => ({ i, title: tasks.find((t) => t.id === e.id)?.title ?? '' }))
      .filter(({ title }) => title.toLowerCase().startsWith(lower));
    if (matches.length === 0) return;
    const next = matches.find((m) => m.i > currentIdx) ?? matches[0];
    if (next) setSelectedTaskId(entries[next.i]?.id ?? null);
  };

  const findTask = (id: string) => tasks.find((t) => t.id === id);

  // Tabでのインデントは「直前に表示されている行」ではなく「同じ深さの直前の兄弟」の子にする。
  // 直前の行を子孫ごと飛ばして同じ深さまで遡ることで、意図せず2階層以上深いサブタスクに
  // なってしまう不具合を防ぐ（改修4回目で報告された「急に2個下の階層になる」問題の修正）
  const indentSelected = () => {
    if (!selectedTaskId || !me || view.type !== 'list') return;
    const entries = visibleTaskEntriesRef.current;
    const idx = entries.findIndex((e) => e.id === selectedTaskId);
    if (idx <= 0) return;
    const currentEntry = entries[idx];
    if (!currentEntry) return;
    const currentDepth = currentEntry.depth;
    let i = idx - 1;
    let prev = entries[i];
    while (prev && prev.depth > currentDepth) {
      i--;
      prev = entries[i];
    }
    if (!prev || prev.depth !== currentDepth) return;
    const newParentId = prev.id;
    const siblings = tasks.filter((t) => t.parent_id === newParentId);
    upsertTask(me.id, selectedTaskId, {
      parent_id: newParentId,
      sort_order: nextSortOrder(siblings),
    });
    setTaskCollapsed(newParentId, false);
  };

  const outdentSelected = () => {
    if (!selectedTaskId || !me) return;
    const task = findTask(selectedTaskId);
    if (!task || !task.parent_id) return;
    const grandParentId = findTask(task.parent_id)?.parent_id ?? null;
    const siblings = tasks.filter((t) => t.parent_id === grandParentId);
    upsertTask(me.id, selectedTaskId, {
      parent_id: grandParentId,
      sort_order: nextSortOrder(siblings),
    });
  };

  // カーソル移動(selectedTaskId)と詳細パネルの開閉(detailOpen)をまとめて行う通常の「選択」操作。
  // 一覧の行クリックや詳細パネル内でのタスク切り替えはこちらを使う
  const selectTask = (id: string | null) => {
    setSelectedTaskId(id);
    setDetailOpen(id !== null);
  };

  // 新規作成したタスクは一覧上で選択するだけでなく、詳細パネルのタイトル欄にも自動フォーカスする
  const selectAndFocusTitle = (id: string) => {
    setSelectedTaskId(id);
    setDetailOpen(true);
    setFocusTitleTaskId(id);
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
    selectAndFocusTitle(id);
    showToast('サブタスクを追加しました');
  };

  // 選択中タスクにサブタスクがあれば折りたたみ/展開をトグルする（改修8回目）
  const toggleSelectedCollapse = () => {
    if (!selectedTaskId) return;
    const hasChildren = tasks.some((t) => t.parent_id === selectedTaskId);
    if (!hasChildren) return;
    setTaskCollapsed(selectedTaskId, !isTaskCollapsed(selectedTaskId));
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
    selectAndFocusTitle(id);
    showToast('タスクを追加しました');
  };

  // Escapeは現在開いている一番手前のパネル/モーダルを1つだけ閉じる。
  // タイトル欄やメモ欄にフォーカスがある状態でそのままEscapeを押すと、保存はonBlurで
  // 行われる設計のため未保存の内容が失われてしまう（改修8回目で報告）。閉じる前に
  // フォーカス中の編集可能要素があればblur()し、同期的にonBlurの保存処理を発火させる
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      ) {
        active.blur();
      }
      if (showSearch) return setShowSearch(false);
      if (showPomodoro) return setShowPomodoro(false);
      if (showTrash) return setShowTrash(false);
      if (showWeeklyReview) return setShowWeeklyReview(false);
      if (showHatchSettings) return setShowHatchSettings(false);
      if (showAdminPanel) return setShowAdminPanel(false);
      if (showKeymapSettings) return setShowKeymapSettings(false);
      if (showHelp) return setShowHelp(false);
      if (drawerOpen) return setDrawerOpen(false);
      if (sidebarFocused) return setSidebarFocused(false);
      // selectedTaskId/detailOpenはタスク画面専用、notesEditorOpenはメモ画面専用の状態。
      // 画面を切り替えても値は保持される（カーソル位置を覚えておくため）ため、screenで
      // 絞り込まないと「メモ画面にいるのにタスク画面の古い選択が先にEscを消費してしまい、
      // メモ詳細が閉じない」不具合になる（改修11回目で発覚）
      if (screen === 'tasks') {
        // 詳細パネルを閉じるだけの1段階目ではカーソル(selectedTaskId)は維持し、
        // そこからj/kで移動を再開できるようにする。完全な選択解除は2段階目のEscで行う
        if (detailOpen) return setDetailOpen(false);
        if (selectedTaskId) return setSelectedTaskId(null);
      } else {
        // メモ詳細も同様に、Escでは閉じるだけでメモ一覧のカーソル位置は維持する（改修11回目）
        if (notesEditorOpen) return notesRef.current?.closeEditor();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showSearch,
    showPomodoro,
    showTrash,
    showWeeklyReview,
    showHatchSettings,
    showAdminPanel,
    showKeymapSettings,
    showHelp,
    drawerOpen,
    sidebarFocused,
    detailOpen,
    selectedTaskId,
    notesEditorOpen,
    screen,
  ]);

  // Ctrl/Cmd+Z(元に戻す)・Ctrl/Cmd+Shift+Z(やり直す)はTab/Escapeと同様固定のショートカット。
  // 入力欄・contentEditable内ではブラウザ標準のテキスト編集undoを優先させ、アプリ側では奪わない
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Hatchが発火して実行が完了したらトーストで知らせる（改修4回目 UI改善案6）。
  // 起動時点で既に終わっている実行は無音で既読扱いにし、以降に新しく完了した実行だけ通知する
  const notifiedHatchRunIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    const HATCH_RUN_STATUS_LABEL: Record<string, string> = {
      succeeded: '成功',
      failed: '失敗',
      timeout: 'タイムアウト',
    };
    async function poll() {
      try {
        const runs = await listHatchRuns();
        if (cancelled || runs.length === 0) return;
        if (notifiedHatchRunIdsRef.current === null) {
          notifiedHatchRunIdsRef.current = new Set(
            runs.filter((r) => r.status in HATCH_RUN_STATUS_LABEL).map((r) => r.id),
          );
          return;
        }
        const latest = runs[0];
        if (!latest) return;
        const label = HATCH_RUN_STATUS_LABEL[latest.status];
        if (label && !notifiedHatchRunIdsRef.current.has(latest.id)) {
          notifiedHatchRunIdsRef.current.add(latest.id);
          // 卵のアイコンをポップさせ、世界観（孵化）のモチーフでHatchの存在感を出す
          // （改修13回目：普段使いの導線から見えず存在に気付きにくいという指摘への対応）
          showToast(`Hatchが発火しました: ${label}`, { icon: <Egg size={14} className="text-amber-400" /> });
        }
      } catch {
        // ポーリング失敗時は次回に任せる
      }
    }
    poll();
    const timer = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [me]);

  // モーダル/設定画面が開いている間はグローバルショートカットを無効化する（改修11回目
  // フォローアップ：設定画面等でショートカットキーを押すと背後の一覧が反応してしまう不具合の対応）。
  // detailOpen/notesEditorOpenは画面を覆う独立モーダルではなく、その状態でこそj/k等の
  // ショートカットが必要な通常の操作対象なので含めない
  const shortcutsSuppressed =
    showSearch ||
    showPomodoro ||
    showTrash ||
    showWeeklyReview ||
    showHatchSettings ||
    showAdminPanel ||
    showKeymapSettings ||
    showHelp ||
    drawerOpen;

  useKeyboardShortcuts(
    keymap,
    {
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
        setDetailOpen(false);
        showToast('削除しました');
      },
      onSetPriorityNone: () => {
        if (!selectedTaskId || !me) return;
        upsertTask(me.id, selectedTaskId, { priority: 0 });
      },
      onSetPriorityLow: () => {
        if (!selectedTaskId || !me) return;
        upsertTask(me.id, selectedTaskId, { priority: 1 });
      },
      onSetPriorityMid: () => {
        if (!selectedTaskId || !me) return;
        upsertTask(me.id, selectedTaskId, { priority: 2 });
      },
      onSetPriorityHigh: () => {
        if (!selectedTaskId || !me) return;
        upsertTask(me.id, selectedTaskId, { priority: 3 });
      },
      onToggleTheme: toggleTheme,
      onShowHelp: () => setShowHelp(true),
      onGotoToday: () => selectView({ type: 'smart', key: 'today' }),
      // フォーカスが左側のサイドバーにある間はj/kでツリーを移動し、メモ画面ではメモ一覧を移動する。
      // それ以外（通常のタスク一覧）は従来通りタスクのカーソル移動（改修10回目）
      onMoveUp: () => {
        if (sidebarFocused) return sidebarRef.current?.moveCursor(-1);
        if (screen === 'notes') return notesRef.current?.moveCursor(-1);
        moveSelection(-1);
      },
      onMoveDown: () => {
        if (sidebarFocused) return sidebarRef.current?.moveCursor(1);
        if (screen === 'notes') return notesRef.current?.moveCursor(1);
        moveSelection(1);
      },
      onIndent: indentSelected,
      onOutdent: outdentSelected,
      onAddSubtask: addSubtaskToSelected,
      onAddSiblingSubtask: addSiblingSubtaskToSelected,
      // タスク画面では以前「折りたたみ切替」だったが、「開く/詳細を見る」という感覚に
      // 合わないとのフィードバックで「開く」（タイトル欄へフォーカス）に変更し、
      // 折りたたみはonToggleCollapse（Shift+Enter）へ分離した（改修11回目）
      onActivate: () => {
        if (sidebarFocused) return sidebarRef.current?.activateCursor();
        if (screen === 'notes') return notesRef.current?.activateCursor();
        // detailOpenがfalse（一覧のみ表示中）だとパネル自体が閉じているため、単に
        // focusTitleTaskIdをセットするだけでは何も起きない。selectAndFocusTitleで
        // detailOpenをtrueにしつつタイトル欄へフォーカスする
        if (selectedTaskId) selectAndFocusTitle(selectedTaskId);
      },
      onToggleCollapse: () => {
        if (sidebarFocused || screen === 'notes') return;
        toggleSelectedCollapse();
      },
      onFocusSelectedTitle: () => {
        if (selectedTaskId) setFocusTitleTaskId(selectedTaskId);
      },
      // hキー：左側エリア（サイドバー）へフォーカスを移す。メモ画面ではサイドバーが
      // 表示されない（NotesColorFilterに差し替わる）ため無効（改修10回目）
      onFocusSidebar: () => {
        if (screen !== 'tasks') return;
        setSidebarFocused(true);
      },
      // タスク/メモ画面切り替え（改修11回目）。切り替え後は前の画面のサイドバーフォーカスを
      // 引きずらないようリセットする
      onSwitchScreen: () => {
        setScreen(screen === 'tasks' ? 'notes' : 'tasks');
        setSidebarFocused(false);
      },
      onGotoFirst: () => {
        if (sidebarFocused) return sidebarRef.current?.gotoFirst();
        if (screen === 'notes') return notesRef.current?.gotoFirst();
        gotoFirstTask();
      },
      onGotoLast: () => {
        if (sidebarFocused) return sidebarRef.current?.gotoLast();
        if (screen === 'notes') return notesRef.current?.gotoLast();
        gotoLastTask();
      },
      onTypeahead: (char) => {
        if (sidebarFocused) return sidebarRef.current?.typeahead(char);
        if (screen === 'notes') return notesRef.current?.typeahead(char);
        typeaheadTask(char);
      },
    },
    shortcutsSuppressed,
  );

  return (
    <div className="flex h-screen flex-col bg-[#FBFAF6] text-neutral-900 dark:bg-[#1a1a18] dark:text-white">
      {/* 管理者バッジ追加後、SyncStatusIndicatorを含めた全ボタンが画面幅に収まらず横スクロールが
          発生し、右端の設定ボタンがスライドしないと押せなくなっていた（改修12回目）。
          十分な幅があるドロワー側（下記）に同期状態を移し、ヘッダーはボタン群のみにした */}
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] dark:border-neutral-800 md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          title="メニュー"
          className="flex min-h-11 min-w-11 items-center justify-center"
        >
          <Menu size={26} />
        </button>
        <div className="flex gap-1">
          <PomodoroHeaderButton
            onClick={() => setShowPomodoro(true)}
            size={18}
            className="min-h-11 min-w-11 justify-center text-red-500"
          />
          <button
            onClick={() => setShowSearch(true)}
            title={`検索 (${keymap.search})`}
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
            title="キーボードショートカット"
            className="flex min-h-11 min-w-11 items-center justify-center text-neutral-400"
          >
            <Keyboard size={18} />
          </button>
          {me?.is_admin && (
            <button
              onClick={() => setShowAdminPanel(true)}
              title="管理"
              className="flex min-h-11 min-w-11 items-center justify-center text-emerald-500"
            >
              <ShieldCheck size={18} />
            </button>
          )}
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
              <PomodoroHeaderButton
                onClick={() => setShowPomodoro(true)}
                size={16}
                className="text-red-500 hover:text-red-600"
              />
              <button
                onClick={() => setShowSearch(true)}
                title={`検索 (${keymap.search})`}
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
                title="キーボードショートカット"
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <Keyboard size={16} />
              </button>
              <button
                onClick={() => setShowTrash(true)}
                title="ゴミ箱"
                className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <Trash2 size={16} />
              </button>
              {me?.is_admin && (
                <button
                  onClick={() => setShowAdminPanel(true)}
                  title="管理"
                  className="text-emerald-500 hover:text-emerald-600"
                >
                  <ShieldCheck size={16} />
                </button>
              )}
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
          <div className="flex justify-center border-b border-neutral-200 py-1 dark:border-neutral-800">
            <SyncStatusIndicator />
          </div>
          {screen === 'tasks' && (
            <Sidebar
              ref={sidebarRef}
              view={view}
              onSelectView={selectView}
              focused={sidebarFocused}
              onLeaveFocus={() => {
                setSidebarFocused(false);
                // Enterでリストを選んだ時、カーソルも中央（先頭タスク）へ移す
                // （改修11回目：エクスプローラーで右矢印/Enterするとペインの先頭項目に
                // フォーカスが移るのと同じ挙動にしてほしいという要望）
                gotoFirstTask();
              }}
              onEnterFocus={() => setSidebarFocused(true)}
              onOpenWeeklyReview={() => setShowWeeklyReview(true)}
            />
          )}
          {screen === 'notes' && (
            <NotesColorFilter
              colorFilter={notesColorFilter}
              onChangeColorFilter={setNotesColorFilter}
            />
          )}
          <div
            onMouseDown={(e) => sidebarResize.startResize(1)(e)}
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-blue-400/40"
          />
        </div>

        {drawerOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div className="animate-[nestio-fade-scale-in_150ms_ease-out] flex w-72 flex-col bg-white dark:bg-neutral-900">
              <div className="border-b border-neutral-200 px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] dark:border-neutral-800">
                <SyncStatusIndicator />
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
                <button
                  onClick={() => setShowTrash(true)}
                  title="ゴミ箱"
                  className="flex min-h-11 min-w-11 items-center justify-center text-neutral-400"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {screen === 'tasks' && (
                <Sidebar
                  view={view}
                  onSelectView={selectView}
                  onOpenWeeklyReview={() => {
                    setDrawerOpen(false);
                    setShowWeeklyReview(true);
                  }}
                />
              )}
              {screen === 'notes' && (
                <NotesColorFilter
                  colorFilter={notesColorFilter}
                  onChangeColorFilter={setNotesColorFilter}
                />
              )}
            </div>
            <div
              className="nestio-overlay flex-1 bg-black/40"
              onClick={() => setDrawerOpen(false)}
            />
          </div>
        )}

        {/* 中央エリアをクリックした時、サイドバーにあったキーボードフォーカスをここへ戻す
            （改修11回目：左エリアにカーソルがある時に中央をクリックしたらそこへ追従してほしい、
            という要望への対応）。captureフェーズだとコントロール済みのチェックボックス
            （タスク完了チェック）のonChangeより先にステート更新が走り、チェックが
            効かなくなる不具合が出たためbubbleフェーズのonClickを使う。チェックボックスの
            <label>は独自にstopPropagationしているため、チェックボックスのクリックはここまで
            伝播しない（意図通り。行クリックには影響しない） */}
        <div
          className="flex min-h-0 min-w-0 flex-1"
          onClick={() => setSidebarFocused(false)}
          onTouchStart={handleEdgeSwipeStart}
          onTouchMove={handleEdgeSwipeMove}
          onTouchEnd={handleEdgeSwipeEnd}
        >
          {screen === 'tasks' ? (
            <>
              <TaskListView
                view={view}
                selectedTaskId={selectedTaskId}
                onSelectTask={selectTask}
                onCreateAndSelectTask={selectAndFocusTitle}
                onVisibleTasksChange={handleVisibleTasksChange}
                detailOpen={detailOpen}
                quickAddInputRef={(el) => {
                  quickAddInputElRef.current = el;
                }}
              />
              <TaskDetailArea
                taskId={detailOpen ? selectedTaskId : null}
                onClose={() => setDetailOpen(false)}
                onMoveUp={() => moveSelection(-1)}
                onMoveDown={() => moveSelection(1)}
                onIndent={indentSelected}
                onOutdent={outdentSelected}
                onSelectTask={selectTask}
                onCreateAndSelectTask={selectAndFocusTitle}
                autoFocusTitle={focusTitleTaskId !== null && focusTitleTaskId === selectedTaskId}
                onTitleFocused={() => setFocusTitleTaskId(null)}
              />
            </>
          ) : (
            <NotesScreen
              ref={notesRef}
              colorFilter={notesColorFilter}
              onEditorOpenChange={setNotesEditorOpen}
            />
          )}
        </div>
      </div>

      {showHelp && <ShortcutHelpModal onClose={() => setShowHelp(false)} />}
      {showKeymapSettings && (
        <KeymapSettings
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={() => setShowKeymapSettings(false)}
        />
      )}
      {showHatchSettings && <HatchSettings onClose={() => setShowHatchSettings(false)} />}
      {showAdminPanel && me?.is_admin && <AdminPanel onClose={() => setShowAdminPanel(false)} />}
      {showPomodoro && <PomodoroTimer onClose={() => setShowPomodoro(false)} />}
      {showTrash && <TrashView onClose={() => setShowTrash(false)} />}
      {showWeeklyReview && <WeeklyReview onClose={() => setShowWeeklyReview(false)} />}
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
      <PushPermissionPrompt />
    </div>
  );
}
