import { useEffect, useRef } from 'react';
import { normalizeKeyCombo, type KeymapAction } from '../../lib/keymap.js';

export interface ShortcutHandlers {
  onQuickAdd: () => void;
  onSearch: () => void;
  onToggleComplete: () => void;
  onDelete: () => void;
  onSetPriority: (p: 0 | 1 | 2 | 3) => void;
  onToggleTheme: () => void;
  onShowHelp: () => void;
  onGotoToday: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onAddSubtask: () => void;
  onAddSiblingSubtask: () => void;
  /** Enter：状況に応じて選択中タスクの折りたたみトグル/サイドバーでの選択/メモの選択を行う（改修10回目で汎用化） */
  onActivate: () => void;
  onFocusSelectedTitle: () => void;
  /** 左側エリア（サイドバーのフォルダ/リストツリー）へキーボードフォーカスを移す固定ショートカット（改修10回目） */
  onFocusSidebar: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** タスク詳細パネル内ではTab/Shift+Tabをフォーム移動に譲り、インデント操作としては扱わない */
function isWithinTaskDetailPanel(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[data-task-detail-panel]') !== null;
}

const PRIORITY_KEYS: Record<string, 0 | 1 | 2 | 3> = { '1': 0, '2': 1, '3': 2, '4': 3 };

type NoArgHandlerKey = {
  [K in keyof ShortcutHandlers]: ShortcutHandlers[K] extends () => void ? K : never;
}[keyof ShortcutHandlers];

const ACTION_HANDLER_KEYS: Record<KeymapAction, NoArgHandlerKey> = {
  quick_add: 'onQuickAdd',
  search: 'onSearch',
  toggle_complete: 'onToggleComplete',
  move_up: 'onMoveUp',
  move_down: 'onMoveDown',
  indent: 'onIndent',
  outdent: 'onOutdent',
  delete: 'onDelete',
  toggle_theme: 'onToggleTheme',
  show_help: 'onShowHelp',
  add_subtask: 'onAddSubtask',
  add_sibling_subtask: 'onAddSiblingSubtask',
};

/**
 * キーマップに従ってショートカットを発火する。入力欄フォーカス中は無効化。
 * 「G→T」（今日へ）と優先度の1〜4キーはカスタマイズ対象外の固定ショートカット
 * （docs/open-questions.md 5章）。
 */
export function useKeyboardShortcuts(keymap: Record<KeymapAction, string>, handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;

  useEffect(() => {
    let pendingG = false;
    let gTimer: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const h = handlersRef.current;
      const km = keymapRef.current;

      if (pendingG) {
        pendingG = false;
        if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          h.onGotoToday();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        h.onSearch();
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'g' || e.key === 'G') {
          pendingG = true;
          gTimer = setTimeout(() => {
            pendingG = false;
          }, 1000);
          return;
        }
        if (e.key in PRIORITY_KEYS) {
          h.onSetPriority(PRIORITY_KEYS[e.key] as 0 | 1 | 2 | 3);
          return;
        }
        // サブタスクを持つ選択中タスクの上でEnter：折りたたみ/展開をトグルする固定ショートカット
        // （G→T・優先度キーと同様カスタマイズ対象外。改修8回目）。
        // このハンドラ経由でtitleInputへフォーカスが移る可能性があるため、preventDefaultしないと
        // ブラウザがこのキー入力自体を新しくフォーカスされた入力欄へ文字として送ってしまうことがある
        if (e.key === 'Enter') {
          e.preventDefault();
          h.onActivate();
          return;
        }
        // 左側エリア（サイドバー）へフォーカスを移す固定ショートカット。vimのhと同じ「左」の意味合いで
        // 割り当てる。j/k（move_up/move_down）は元々タスク一覧の移動用だったが、フォーカスが
        // サイドバーにある間はそちらの移動に使う（改修10回目）
        if (e.key === 'h') {
          e.preventDefault();
          h.onFocusSidebar();
          return;
        }
        // 選択中タスクの詳細パネルのタイトル欄へフォーカスを移す固定ショートカット。
        // move_up/move_down（j/k）でのタスク選択はキーボード操作のテンポを保つためあえて
        // フォーカスを奪わない設計だが、そのままではマウス無しでタイトル/メモを編集する手段が
        // 無かった（改修8回目でのキーボード操作性改善の指摘）。
        // preventDefaultしないと、フォーカスが移った直後のタイトル入力欄へ「e」の文字自体が
        // 入力されてしまう（実機・Playwright双方で確認済みの実際の不具合）
        if (e.key === 'e') {
          e.preventDefault();
          h.onFocusSelectedTitle();
          return;
        }
      }

      if (e.key === 'Tab' && isWithinTaskDetailPanel(e.target)) return;

      const combo = normalizeKeyCombo(e);
      for (const [action, key] of Object.entries(km) as [KeymapAction, string][]) {
        if (key === combo) {
          e.preventDefault();
          h[ACTION_HANDLER_KEYS[action]]();
          return;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (gTimer) clearTimeout(gTimer);
    };
  }, []);
}
