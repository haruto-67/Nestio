import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  onQuickAdd: () => void;
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

/**
 * デフォルトキーマップ（docs/task-app-requirements.md 3.13）。
 * 入力欄フォーカス中は無効化する。キーマップのユーザーカスタマイズUIはPhase 1の後続作業。
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let pendingG = false;
    let gTimer: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const h = handlersRef.current;

      if (pendingG) {
        pendingG = false;
        if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          h.onGotoToday();
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        h.onToggleTheme();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          h.onQuickAdd();
          break;
        case ' ':
        case 'x':
        case 'X':
          e.preventDefault();
          h.onToggleComplete();
          break;
        case 'Delete':
          e.preventDefault();
          h.onDelete();
          break;
        case 'j':
        case 'J':
          h.onMoveDown();
          break;
        case 'k':
        case 'K':
          h.onMoveUp();
          break;
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey) h.onOutdent();
          else h.onIndent();
          break;
        case 'g':
        case 'G':
          pendingG = true;
          gTimer = setTimeout(() => {
            pendingG = false;
          }, 1000);
          break;
        case '?':
          h.onShowHelp();
          break;
        default:
          if (e.key in PRIORITY_KEYS) {
            h.onSetPriority(PRIORITY_KEYS[e.key] as 0 | 1 | 2 | 3);
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
