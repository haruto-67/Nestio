import { useRef, useState } from 'react';
import type { TagRow } from '@nestio/shared';
import { FilterIcon } from '../../ui/icons.js';
import { useOutsideClick } from '../../lib/useOutsideClick.js';
import { createCustomView } from '../../lib/custom-views.js';
import { showToast } from '../../ui/toast.js';

const PRIORITY_FILTER_LABELS: Record<number, string> = { 0: 'なし', 1: '低', 2: '中', 3: '高' };

interface TaskListFilterMenuProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  priorityFilter: number | 'all';
  onPriorityFilterChange: (value: number | 'all') => void;
  allTags: TagRow[];
  tagFilter: string[];
  onTagFilterChange: (tagFilter: string[]) => void;
}

/** タスク一覧ヘッダーの「絞り込み」ポップオーバー（優先度・タグ・カスタムビュー保存）。
 * 以前は優先度セレクト・タグボタンが並んでリスト名を圧迫していたため1アイコンに集約した
 * （改修9回目）。改修13回目：見通し改善のためTaskListView.tsxから切り出した */
export function TaskListFilterMenu({
  open,
  onToggle,
  onClose,
  priorityFilter,
  onPriorityFilterChange,
  allTags,
  tagFilter,
  onTagFilterChange,
}: TaskListFilterMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useOutsideClick(menuRef, onClose, open);
  const [newViewName, setNewViewName] = useState('');

  const toggleTag = (tagId: string, checked: boolean) => {
    onTagFilterChange(checked ? [...tagFilter, tagId] : tagFilter.filter((id) => id !== tagId));
  };

  const saveView = () => {
    const trimmed = newViewName.trim();
    if (!trimmed) return;
    createCustomView(trimmed, tagFilter);
    setNewViewName('');
    onTagFilterChange([]);
    onClose();
    showToast('カスタムビューを保存しました');
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title="絞り込み"
        className={`relative flex min-h-8 min-w-8 items-center justify-center rounded-md border ${
          priorityFilter !== 'all' || tagFilter.length > 0
            ? 'border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-300'
            : 'border-neutral-200 text-neutral-500 dark:border-neutral-700'
        }`}
      >
        <FilterIcon size={16} />
        {(priorityFilter !== 'all' || tagFilter.length > 0) && (
          <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full right-0 z-10 mt-1 flex w-52 flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <select
            value={priorityFilter}
            onChange={(e) => onPriorityFilterChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            title="優先度で絞り込み"
            className="w-full rounded-md border border-neutral-200 bg-transparent p-1 text-xs dark:border-neutral-700"
          >
            <option value="all">すべての優先度</option>
            {([3, 2, 1, 0] as const).map((p) => (
              <option key={p} value={p}>
                優先度: {PRIORITY_FILTER_LABELS[p]}
              </option>
            ))}
          </select>
          {allTags.length > 0 && (
            <div className="flex flex-col gap-0.5 border-t border-neutral-100 pt-2 dark:border-neutral-800">
              <span className="px-1 text-[10px] font-medium text-neutral-400">タグで絞り込み</span>
              <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                {allTags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <input
                      type="checkbox"
                      checked={tagFilter.includes(tag.id)}
                      onChange={(e) => toggleTag(tag.id, e.target.checked)}
                    />
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="truncate">{tag.name}</span>
                  </label>
                ))}
              </div>
              {tagFilter.length > 0 && (
                <>
                  <button
                    onClick={() => onTagFilterChange([])}
                    className="mt-1 rounded-md px-1 py-1 text-left text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    クリア
                  </button>
                  <div className="mt-1 flex gap-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
                    <input
                      value={newViewName}
                      onChange={(e) => setNewViewName(e.target.value)}
                      placeholder="ビュー名を入力して保存"
                      className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-1 py-0.5 text-xs dark:border-neutral-700"
                    />
                    <button
                      onClick={saveView}
                      className="shrink-0 rounded-md border border-blue-300 px-1.5 text-xs text-blue-600 dark:border-blue-700 dark:text-blue-300"
                    >
                      保存
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
