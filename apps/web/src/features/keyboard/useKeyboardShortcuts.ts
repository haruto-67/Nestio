import { useEffect, useRef } from 'react';
import { normalizeKeyCombo, normalizeKeyComboUnified, isBareCharCombo, type KeymapAction } from '../../lib/keymap.js';

export interface ShortcutHandlers {
  onQuickAdd: () => void;
  onSearch: () => void;
  onToggleComplete: () => void;
  onDelete: () => void;
  onSetPriorityNone: () => void;
  onSetPriorityLow: () => void;
  onSetPriorityMid: () => void;
  onSetPriorityHigh: () => void;
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
  /** 左側エリア（サイドバーのフォルダ/リストツリー）へキーボードフォーカスを移す（改修10回目） */
  onFocusSidebar: () => void;
  /** タスク画面/メモ画面を切り替える（改修11回目） */
  onSwitchScreen: () => void;
  /** カーソルのあるエリアの先頭/末尾の項目へ移動する（改修11回目） */
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
  goto_today: 'onGotoToday',
  priority_none: 'onSetPriorityNone',
  priority_low: 'onSetPriorityLow',
  priority_mid: 'onSetPriorityMid',
  priority_high: 'onSetPriorityHigh',
  focus_title: 'onFocusSelectedTitle',
  focus_sidebar: 'onFocusSidebar',
  activate: 'onActivate',
  goto_first: 'onGotoFirst',
  goto_last: 'onGotoLast',
};

/**
 * キーマップに従ってショートカットを発火する。入力欄フォーカス中や、suppressed が
 * true の間（モーダル/設定画面が開いている時。改修11回目フォローアップ）は無効化。
 *
 * 全ショートカットは修飾キー必須がデフォルトだが、ユーザーが意図して無修飾の文字キーへ
 * 再割り当てすることも許可している（改修11回目フォローアップ）。修飾キー無しの1文字キー
 * 入力はどれにもマッチしなかった場合、タイプアヘッド（頭文字ジャンプ）として扱う
 */
export function useKeyboardShortcuts(
  keymap: Record<KeymapAction, string>,
  handlers: ShortcutHandlers,
  suppressed = false,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (suppressedRef.current) return;
      const h = handlersRef.current;
      const km = keymapRef.current;
      const specificCombo = normalizeKeyCombo(e);
      const unifiedCombo = normalizeKeyComboUnified(e);

      // 検索だけは常時Ctrl/Cmd+Kでも起動できる固定の別名（キーマップの割り当てを壊しても
      // 検索だけは必ず使えるようにするための保険）。CtrlとCmdを区別できるようにしたため
      // （改修11回目フォローアップ）、ここは意図的にunifiedComboで判定しどちらでも動くようにする
      if (unifiedCombo === 'Ctrl+k') {
        e.preventDefault();
        h.onSearch();
        return;
      }

      if (e.key === 'Tab' && isWithinTaskDetailPanel(e.target)) return;

      // まずCmd/Ctrlを明示的に使い分けたいユーザー設定（specificCombo）を優先し、
      // 見つからなければ「Ctrl+…」形式の既定値に対する後方互換マッチ（unifiedCombo。
      // Ctrl/Cmdどちらでも動く）を試す（改修11回目フォローアップ）
      let matchedAction: KeymapAction | null = null;
      for (const [action, key] of Object.entries(km) as [KeymapAction, string][]) {
        if (key === specificCombo) {
          matchedAction = action;
          break;
        }
      }
      if (!matchedAction && specificCombo !== unifiedCombo) {
        for (const [action, key] of Object.entries(km) as [KeymapAction, string][]) {
          if (key === unifiedCombo) {
            matchedAction = action;
            break;
          }
        }
      }
      if (matchedAction) {
        e.preventDefault();
        h[ACTION_HANDLER_KEYS[matchedAction]]();
        return;
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
