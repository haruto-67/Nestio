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

const FIXED_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '1〜4', label: '優先度を変更（なし/低/中/高）' },
  { keys: 'G → T', label: '「今日」ビューへ' },
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
    setKey(action, normalizeKeyCombo(e.nativeEvent));
    setCapturing(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-80 rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-900 nestio-modal-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">キーボードショートカット</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        {conflicts.length > 0 && (
          <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
            同じキーが複数の操作に割り当てられています。先に定義された操作が優先されます。
          </p>
        )}

        <ul className="flex flex-col gap-1.5 text-sm">
          {(KEYMAP_ACTIONS as readonly KeymapAction[]).map((action) => (
            <li key={action} className="flex items-center justify-between gap-3">
              <span
                className={conflictActions.has(action) ? 'text-red-500' : 'text-neutral-500 dark:text-neutral-400'}
              >
                {KEYMAP_ACTION_LABELS[action]}
                {conflictActions.has(action) && <AlertTriangle size={12} className="ml-1 inline text-red-500" />}
              </span>
              <button
                onClick={() => setCapturing(action)}
                onKeyDown={handleCapture(action)}
                onBlur={() => setCapturing((c) => (c === action ? null : c))}
                className={`rounded border px-2 py-1 text-xs ${
                  capturing === action
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40'
                    : 'border-neutral-300 dark:border-neutral-700'
                }`}
              >
                {capturing === action ? 'キーを押してください…' : keymap[action]}
              </button>
            </li>
          ))}
          {FIXED_SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-3">
              <span className="text-neutral-500 dark:text-neutral-400">{s.label}</span>
              <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-400">
          クリックしてキーを押すと割り当てを変更できます。「今日」へ（G→T）・優先度変更（1〜4）は固定です。
          入力欄にフォーカス中は無効になります
        </p>
      </div>
    </div>
  );
}
