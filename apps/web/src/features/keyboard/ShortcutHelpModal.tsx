import { useState, type KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  KEYMAP_ACTIONS,
  KEYMAP_ACTION_LABELS,
  findKeymapConflicts,
  normalizeKeyCombo,
  isBareCharCombo,
  type KeymapAction,
} from '../../lib/keymap.js';
import { useKeymap } from '../../state/useKeymap.js';

const FIXED_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Cmd/Ctrl + Shift + 1〜4', label: '優先度を変更（なし/低/中/高）' },
  { keys: 'Cmd/Ctrl + Shift + T', label: '「今日」ビューへ' },
  {
    keys: 'Enter',
    label: '選択中タスクのサブタスクを折りたたみ/展開（サイドバー移動中はその項目を開く、メモ画面ではメモを開く）',
  },
  { keys: 'Cmd/Ctrl + Shift + E', label: '選択中タスクのタイトル欄へフォーカス（メモ欄へはTabで移動）' },
  {
    keys: 'Cmd/Ctrl + Shift + H',
    label: '左側のサイドバーへフォーカスを移す（J/Kで移動、Enterで開いて中央へ戻る、Escで戻る）',
  },
  { keys: 'Home / End', label: 'カーソルのあるエリアの先頭/末尾の項目へ移動' },
  { keys: '文字キー（単独）', label: 'カーソルのあるエリアで頭文字が一致する項目へジャンプ（同じ文字を連続で押すと次の候補へ）' },
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
  const [rejected, setRejected] = useState(false);

  const handleCapture = (action: KeymapAction) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (capturing !== action) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    // 修飾キー無しの1文字キーはタイプアヘッド用に予約されているため割り当てられない
    if (isBareCharCombo(e.nativeEvent)) {
      setRejected(true);
      return;
    }
    setRejected(false);
    setKey(action, normalizeKeyCombo(e.nativeEvent));
    setCapturing(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-80 rounded-xl bg-white p-4 shadow-lg dark:bg-neutral-900 nestio-modal-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">キーボードショートカット</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        {conflicts.length > 0 && (
          <p className="mb-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
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
                onClick={() => {
                  setCapturing(action);
                  setRejected(false);
                }}
                onKeyDown={handleCapture(action)}
                onBlur={() => setCapturing((c) => (c === action ? null : c))}
                className={`rounded-md border px-2 py-1 text-xs ${
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
              <kbd className="rounded-md border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        {rejected && (
          <p className="mt-2 text-xs text-red-500">
            修飾キー（Cmd/Ctrl・Shift等）を含まないキーは頭文字ジャンプ用に予約されているため割り当てられません
          </p>
        )}
        <p className="mt-3 text-xs text-neutral-400">
          クリックしてキーを押すと割り当てを変更できます（修飾キー必須）。「今日」へ・優先度変更・
          タイトルへ・サイドバーへは固定です。入力欄にフォーカス中は無効になります
        </p>
      </div>
    </div>
  );
}
