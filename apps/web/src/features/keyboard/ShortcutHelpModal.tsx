const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'N', label: 'クイック追加' },
  { keys: 'Space / X', label: '選択中タスクを完了' },
  { keys: 'J / K', label: '上下移動' },
  { keys: 'Tab / Shift+Tab', label: 'サブタスクにする / 戻す' },
  { keys: '1〜4', label: '優先度を変更（なし/低/中/高）' },
  { keys: 'Delete', label: '削除' },
  { keys: 'G → T', label: '「今日」ビューへ' },
  { keys: 'Cmd/Ctrl + Shift + L', label: 'ダーク / ライト切替' },
  { keys: '?', label: 'このヘルプを表示' },
];

export function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-80 rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">キーボードショートカット</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-3">
              <span className="text-neutral-500 dark:text-neutral-400">{s.label}</span>
              <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-400">入力欄にフォーカス中は無効になります</p>
      </div>
    </div>
  );
}
