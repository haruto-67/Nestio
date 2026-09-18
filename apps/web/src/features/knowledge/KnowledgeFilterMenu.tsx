import { useRef } from 'react';
import type { TagRow } from '@nestio/shared';
import { FilterIcon } from '../../ui/icons.js';
import { useOutsideClick } from '../../lib/useOutsideClick.js';

interface KnowledgeFilterMenuProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  allTags: TagRow[];
  tagFilter: string[];
  onTagFilterChange: (tagFilter: string[]) => void;
}

/** ナレッジ一覧のタグ絞り込みポップオーバー（TaskListFilterMenuの簡易版。改修24回目フォローアップ） */
export function KnowledgeFilterMenu({
  open,
  onToggle,
  onClose,
  allTags,
  tagFilter,
  onTagFilterChange,
}: KnowledgeFilterMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  useOutsideClick(menuRef, onClose, open);

  const toggleTag = (tagId: string, checked: boolean) => {
    onTagFilterChange(checked ? [...tagFilter, tagId] : tagFilter.filter((id) => id !== tagId));
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title="タグで絞り込み"
        className={`relative flex min-h-8 min-w-8 items-center justify-center rounded-md border ${
          tagFilter.length > 0
            ? 'border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-300'
            : 'border-neutral-200 text-neutral-500 dark:border-neutral-700'
        }`}
      >
        <FilterIcon size={16} />
        {tagFilter.length > 0 && <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />}
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full right-0 z-10 mt-1 flex w-52 flex-col gap-1 rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {allTags.length === 0 ? (
            <span className="px-1 py-1 text-xs text-neutral-400">タグがありません</span>
          ) : (
            <>
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
                <button
                  onClick={() => onTagFilterChange([])}
                  className="mt-1 rounded-md px-1 py-1 text-left text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  クリア
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
