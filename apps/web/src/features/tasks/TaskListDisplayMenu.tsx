import { useRef } from 'react';
import type { ListSortMode } from '@nestio/shared';
import { LayoutList, Kanban, CalendarDays } from 'lucide-react';
import { NestViewIcon } from '../../ui/icons.js';
import { useOutsideClick } from '../../lib/useOutsideClick.js';

export type TaskDisplayMode = 'list' | 'kanban' | 'calendar';

const DISPLAY_MODE_OPTIONS: { mode: TaskDisplayMode; label: string; Icon: typeof LayoutList }[] = [
  { mode: 'list', label: 'リスト', Icon: LayoutList },
  { mode: 'kanban', label: 'カンバン', Icon: Kanban },
  { mode: 'calendar', label: 'カレンダー', Icon: CalendarDays },
];

interface TaskListDisplayMenuProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  displayMode: TaskDisplayMode;
  onChangeDisplayMode: (mode: TaskDisplayMode) => void;
  /** 並び替えセレクトはリストビュー（view.type === 'list'）の時だけ表示する */
  showSortMode: boolean;
  sortMode: ListSortMode;
  onChangeSortMode: (mode: ListSortMode) => void;
}

/** タスク一覧ヘッダーの「表示方法」ポップオーバー（リスト/カンバン/カレンダー切替・並び替え）
 * （改修9回目）。改修13回目：見通し改善のためTaskListView.tsxから切り出した */
export function TaskListDisplayMenu({
  open,
  onToggle,
  onClose,
  displayMode,
  onChangeDisplayMode,
  showSortMode,
  sortMode,
  onChangeSortMode,
}: TaskListDisplayMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useOutsideClick(menuRef, onClose, open);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title="表示方法"
        className="flex min-h-8 min-w-8 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 dark:border-neutral-700"
      >
        <NestViewIcon size={16} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full right-0 z-10 mt-1 flex w-44 flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex rounded-md border border-surface-border">
            {DISPLAY_MODE_OPTIONS.map(({ mode, label, Icon }) => (
              <button
                key={mode}
                onClick={() => onChangeDisplayMode(mode)}
                title={label}
                className={`flex min-h-8 flex-1 items-center justify-center px-1.5 first:rounded-l-lg last:rounded-r-lg ${
                  displayMode === mode
                    ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'
                }`}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
          {showSortMode && (
            <select
              value={sortMode}
              onChange={(e) => onChangeSortMode(e.target.value as ListSortMode)}
              className="w-full rounded-md border border-neutral-200 bg-transparent p-1 text-xs dark:border-neutral-700"
            >
              <option value="custom">カスタム</option>
              <option value="due">期限順</option>
              <option value="priority">優先度順</option>
              <option value="name">名前順</option>
            </select>
          )}
        </div>
      )}
    </div>
  );
}
