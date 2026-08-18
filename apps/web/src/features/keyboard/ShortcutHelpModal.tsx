import { useState, type KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  KEYMAP_ACTIONS,
  KEYMAP_ACTION_LABELS,
  findKeymapConflicts,
  normalizeKeyCombo,
  type KeymapAction,
} from '../../lib/keymap.js';
import { useKeymap } from '../../state/useKeymap.js';

// 検索・元に戻す・やり直しはブラウザ/OS標準の慣習に従う固定値。それ以外は全てキーマップで
// 変更可能にした（改修11回目フォローアップ：固定ショートカットも変えたいという要望への対応）
const FIXED_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Cmd/Ctrl + K', label: '検索（キーマップの割り当てに加えて常に有効）' },
  { keys: 'Cmd/Ctrl + Z', label: '元に戻す' },
  { keys: 'Cmd/Ctrl + Shift + Z', label: 'やり直す' },
];

/** ショートカット一覧の表示と、キー割り当ての変更（クリックしてキー入力で上書き）を1画面で行う */
export function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  const { keymap, setKey } = useKeymap();
  const [capturing, setCapturing] = useState<KeymapAction | null>(null);

  const conflicts = findKeymapConflicts(keymap);
  const conflictActions = new Set(conflicts.flat());

  const handleCapture = (action: KeymapAction) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (capturing !== action) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    // 修飾キー無しの1文字キー（タイプアヘッド用）への割り当ても、本人が意図して選んだのであれば
    // 許可する（改修11回目フォローアップ）。その場合その文字はそのアクション専用になり、
    // タイプアヘッドの頭文字候補としては使えなくなる
    setKey(action, normalizeKeyCombo(e.nativeEvent));
    setCapturing(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[40rem] max-w-[95vw] flex-col rounded-xl bg-surface p-4 shadow-lg nestio-modal-panel"
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h2 className="text-sm font-semibold">キーボードショートカット</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        {conflicts.length > 0 && (
          <p className="mb-2 shrink-0 rounded-md bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
            同じキーが複数の操作に割り当てられています。先に定義された操作が優先されます。
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            {(KEYMAP_ACTIONS as readonly KeymapAction[]).map((action) => (
              <li key={action} className="flex items-center justify-between gap-2">
                <span
                  className={`min-w-0 truncate ${
                    conflictActions.has(action) ? 'text-red-500' : 'text-muted'
                  }`}
                  title={KEYMAP_ACTION_LABELS[action]}
                >
                  {KEYMAP_ACTION_LABELS[action]}
                  {conflictActions.has(action) && <AlertTriangle size={12} className="ml-1 inline text-red-500" />}
                </span>
                <button
                  onClick={() => setCapturing(action)}
                  onKeyDown={handleCapture(action)}
                  onBlur={() => setCapturing((c) => (c === action ? null : c))}
                  className={`shrink-0 rounded-md border px-2 py-1 text-xs whitespace-nowrap ${
                    capturing === action
                      ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40'
                      : 'border-neutral-300 dark:border-neutral-700'
                  }`}
                >
                  {capturing === action ? 'キーを押してください…' : keymap[action]}
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
              {FIXED_SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-muted">{s.label}</span>
                  <kbd className="shrink-0 rounded-md border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-xs whitespace-nowrap dark:border-neutral-700 dark:bg-neutral-800">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-3 shrink-0 text-xs text-neutral-400">
          クリックしてキーを押すと割り当てを変更できます。修飾キー無しの文字キーはカーソルのあるエリアで
          頭文字ジャンプに使われますが、あえて単独の文字キーへ割り当てることもできます（その文字は
          頭文字ジャンプの候補では無くなります）。入力欄にフォーカス中は無効になります
        </p>
      </div>
    </div>
  );
}
