import { useNotes } from '../../db/queries.js';
import { BackgroundMark } from '../../ui/BackgroundMark.js';

interface NotesColorFilterProps {
  colorFilter: string | null;
  onChangeColorFilter: (color: string | null) => void;
}

/**
 * メモ画面選択時、タスク画面のSidebarが表示されない左側の余白が空いて見えるという指摘への対応
 * （改修9回目）。メモに実際に使われている色だけを一覧し、その色のメモだけに絞り込める。
 * 下に隙間ができるのは避けられないため、BackgroundMarkを大きめに配置してデザインで埋める
 * （選択肢と重なってもよいとの回答済み）
 */
export function NotesColorFilter({ colorFilter, onChangeColorFilter }: NotesColorFilterProps) {
  const notes = useNotes();
  const usedColors = [...new Set(notes.map((n) => n.color))];

  return (
    <nav className="relative flex h-full flex-col overflow-hidden bg-neutral-50 text-sm dark:bg-neutral-950">
      <div className="flex flex-col gap-0.5 p-2">
        <span className="px-2 pt-1 pb-0.5 text-xs font-semibold text-neutral-400 uppercase">色で絞り込み</span>
        <button
          onClick={() => onChangeColorFilter(null)}
          className={`flex items-center gap-2 rounded px-2 py-1.5 text-left ${
            colorFilter === null
              ? 'bg-blue-100 font-medium dark:bg-blue-900/40'
              : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
          }`}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-neutral-300 dark:border-neutral-600" />
          すべて
        </button>
        {usedColors.map((color) => (
          <button
            key={color}
            onClick={() => onChangeColorFilter(color)}
            title={color}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left ${
              colorFilter === color
                ? 'bg-blue-100 font-medium dark:bg-blue-900/40'
                : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 dark:border-white/10"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {notes.filter((n) => n.color === color).length}件
            </span>
          </button>
        ))}
      </div>
      <BackgroundMark className="pointer-events-none absolute -bottom-6 left-1/2 z-0 h-56 w-56 -translate-x-1/2 opacity-40" />
    </nav>
  );
}
