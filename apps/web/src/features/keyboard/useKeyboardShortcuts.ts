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
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
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
      }

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
