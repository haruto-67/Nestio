import { useEffect, useRef } from 'react';
import { normalizeKeyCombo, isBareCharCombo, type KeymapAction } from '../../lib/keymap.js';

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
  /** タスク画面/メモ画面を切り替える（改修11回目） */
  onSwitchScreen: () => void;
  /** カーソルのあるエリアの先頭/末尾の項目へ移動する（Home/End、改修11回目） */
  onGotoFirst: () => void;
  onGotoLast: () => void;
  /** 修飾キー無しの1文字キー入力。カーソルのあるエリアでエクスプローラー風の
   * タイプアヘッド（頭文字ジャンプ）を行う（改修11回目） */
  onTypeahead: (char: string) => void;
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
  switch_screen: 'onSwitchScreen',
};

/** カスタマイズ不可の固定ショートカット。全て修飾キー必須にしてあり、キーマップの
 * カスタマイズ値と衝突する可能性はキーマップ側のバリデーション（isBareCharCombo）で防ぐ */
function buildFixedActions(h: ShortcutHandlers): Record<string, () => void> {
  return {
    'Ctrl+k': h.onSearch, // Cmd/Ctrl+K：キーマップの割り当てに加えて常に有効な検索の別名
    'Ctrl+Shift+t': h.onGotoToday,
    'Ctrl+Shift+1': () => h.onSetPriority(0),
    'Ctrl+Shift+2': () => h.onSetPriority(1),
    'Ctrl+Shift+3': () => h.onSetPriority(2),
    'Ctrl+Shift+4': () => h.onSetPriority(3),
    'Ctrl+Shift+e': h.onFocusSelectedTitle,
    'Ctrl+Shift+h': h.onFocusSidebar,
  };
}

/**
 * キーマップに従ってショートカットを発火する。入力欄フォーカス中は無効化。
 * 「今日へ」・優先度の1〜4キー・E（タイトルへ）・H（サイドバーへ）はカスタマイズ対象外の
 * 固定ショートカット（docs/open-questions.md 5章）。
 *
 * 全ショートカットは修飾キー必須（改修11回目）。修飾キー無しの1文字キー入力はどれにも
 * マッチしなかった場合、タイプアヘッド（頭文字ジャンプ）として扱う
 */
export function useKeyboardShortcuts(keymap: Record<KeymapAction, string>, handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const h = handlersRef.current;
      const km = keymapRef.current;
      const combo = normalizeKeyCombo(e);

      const fixedAction = buildFixedActions(h)[combo];
      if (fixedAction) {
        e.preventDefault();
        fixedAction();
        return;
      }

      // サブタスクを持つ選択中タスクの上でEnter：折りたたみ/展開をトグルする固定ショートカット
      // （改修8回目）。このハンドラ経由でtitleInputへフォーカスが移る可能性があるため、
      // preventDefaultしないとブラウザがこのキー入力自体を新しくフォーカスされた入力欄へ
      // 文字として送ってしまうことがある
      if (e.key === 'Enter') {
        e.preventDefault();
        h.onActivate();
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        h.onGotoFirst();
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        h.onGotoLast();
        return;
      }

      if (e.key === 'Tab' && isWithinTaskDetailPanel(e.target)) return;

      for (const [action, key] of Object.entries(km) as [KeymapAction, string][]) {
        if (key === combo) {
          e.preventDefault();
          h[ACTION_HANDLER_KEYS[action]]();
          return;
        }
      }

      // ここまでで何にもマッチしなかった、修飾キー無しの1文字キー入力はタイプアヘッドとして扱う
      // （エクスプローラーと同じ挙動：頭文字にジャンプ。同じ文字を連続で押すと次の候補へ循環する）
      if (isBareCharCombo(e)) {
        h.onTypeahead(e.key);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
