import { KEYMAP_ACTIONS, KEYMAP_ACTION_LABELS, type KeymapAction } from '../../lib/keymap.js';
import { useKeymap } from '../../state/useKeymap.js';

const FIXED_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: '1〜4', label: '優先度を変更（なし/低/中/高）' },
  { keys: 'G → T', label: '「今日」ビューへ' },
  { keys: 'Cmd/Ctrl + K', label: '検索（キーマップの割り当てに加えて常に有効）' },
];

export function ShortcutHelpModal({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const { keymap } = useKeymap();

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
        <ul className="flex flex-col gap-1.5 text-sm">
          {(KEYMAP_ACTIONS as readonly KeymapAction[]).map((action) => (
            <li key={action} className="flex items-center justify-between gap-3">
              <span className="text-neutral-500 dark:text-neutral-400">{KEYMAP_ACTION_LABELS[action]}</span>
              <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                {keymap[action]}
              </kbd>
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
        <button onClick={onOpenSettings} className="mt-3 text-xs text-blue-500 hover:underline">
          キー割り当てを変更する
        </button>
        <p className="mt-2 text-xs text-neutral-400">入力欄にフォーカス中は無効になります</p>
      </div>
    </div>
  );
}
