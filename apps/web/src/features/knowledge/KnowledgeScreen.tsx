import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { uuidv7, type KnowledgeRow, type SearchKnowledgeResult } from '@nestio/shared';
import { Plus } from 'lucide-react';
import { useApp } from '../../state/AppProvider.js';
import { useKnowledgeList, useTags, useKnowledgeTags } from '../../db/queries.js';
import { upsertKnowledge } from '../../state/actions.js';
import { search } from '../../api/search.js';
import { KnowledgeEditor } from './KnowledgeEditor.js';
import { KnowledgeFilterMenu } from './KnowledgeFilterMenu.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from './categories.js';
import { BackgroundMark } from '../../ui/BackgroundMark.js';
import { usePanelTransition, useDelayedHide } from '../../lib/panel-transition.js';

type SortMode = 'updated' | 'title';
const SORT_MODE_KEY = 'nestio_knowledge_sort';
const SEARCH_DEBOUNCE_MS = 200;

export interface KnowledgeScreenHandle {
  moveCursor: (direction: -1 | 1) => void;
  activateCursor: () => void;
  gotoFirst: () => void;
  gotoLast: () => void;
  typeahead: (char: string) => void;
  closeEditor: () => void;
  createNew: () => void;
}

export interface KnowledgeScreenProps {
  /** ナレッジ詳細(KnowledgeEditor)の開閉状態が変わった時に呼ばれる。Escでの一括クローズに使う */
  onEditorOpenChange?: (open: boolean) => void;
}

const collator = new Intl.Collator(undefined, { numeric: true });

export const KnowledgeScreen = forwardRef<KnowledgeScreenHandle, KnowledgeScreenProps>(function KnowledgeScreen(
  { onEditorOpenChange },
  ref,
) {
  const { me } = useApp();
  const knowledge = useKnowledgeList();
  const allTags = useTags();
  const knowledgeTags = useKnowledgeTags();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>(
    () => (localStorage.getItem(SORT_MODE_KEY) as SortMode | null) ?? 'updated',
  );
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchKnowledgeResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const changeSortMode = (mode: SortMode) => {
    setSortMode(mode);
    localStorage.setItem(SORT_MODE_KEY, mode);
  };

  // 一覧の並び：カテゴリは要件定義の固定順（プロフィール→プロジェクト→トピック→人物）で
  // グルーピングし、各グループ内をsortModeで並べる。フラット化した配列を
  // j/k移動・タイプアヘッド・Enterでの起動すべてに共通で使う（NotesScreenと同じ設計）
  const filtered =
    tagFilter.length === 0
      ? knowledge
      : knowledge.filter((k) => {
          const tagIds = knowledgeTags.filter((t) => t.knowledge_id === k.id).map((t) => t.tag_id);
          return tagFilter.every((tagId) => tagIds.includes(tagId));
        });

  const sortWithin = (items: KnowledgeRow[]) =>
    [...items].sort((a, b) =>
      sortMode === 'title' ? collator.compare(a.title, b.title) : b.updated_at - a.updated_at,
    );

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: sortWithin(filtered.filter((k) => k.category === category)),
  })).filter((g) => g.items.length > 0);

  const flattened = grouped.flatMap((g) => g.items);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const timer = setTimeout(() => {
      search(trimmed)
        .then((res) => {
          if (!cancelled) setSearchResults(res.knowledge);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    containerRef.current?.querySelector(`[data-knowledge-index="${cursorIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursorIndex]);

  const openKnowledge = (id: string) => {
    setSelectedId(id);
    onEditorOpenChange?.(true);
  };
  const closeEditor = () => {
    setSelectedId(null);
    onEditorOpenChange?.(false);
  };
  const openKnowledgeByTitle = (title: string) => {
    const found = knowledge.find((k) => k.title === title);
    if (found) openKnowledge(found.id);
  };

  const clampIndex = (i: number) => Math.min(Math.max(i, 0), Math.max(flattened.length - 1, 0));

  const {
    displayedId: displayedKnowledgeId,
    closing: editorClosing,
    generation: editorGeneration,
  } = usePanelTransition(selectedId);
  const hideListForEditor = useDelayedHide(selectedId !== null);

  const createKnowledge = () => {
    if (!me) return;
    const id = uuidv7();
    // titleはユーザー内で一意な制約があるため、空文字のまま複数作ると衝突する。
    // idの先頭部分を使い衝突しない仮タイトルにしておき、ユーザーが後で自由に変更する
    upsertKnowledge(me.id, id, { title: `無題-${id.slice(0, 8)}`, description: '', category: 'topic' });
    openKnowledge(id);
  };

  useImperativeHandle(ref, () => ({
    moveCursor: (direction: -1 | 1) => setCursorIndex((i) => clampIndex(i + direction)),
    gotoFirst: () => setCursorIndex(0),
    gotoLast: () => setCursorIndex(clampIndex(flattened.length - 1)),
    typeahead: (char: string) => {
      const lower = char.toLowerCase();
      const matches = flattened
        .map((k, i) => ({ i, title: k.title }))
        .filter(({ title }) => title.toLowerCase().startsWith(lower));
      if (matches.length === 0) return;
      const next = matches.find((m) => m.i > cursorIndex) ?? matches[0];
      if (next) setCursorIndex(next.i);
    },
    activateCursor: () => {
      const k = flattened[cursorIndex];
      if (k) openKnowledge(k.id);
    },
    closeEditor,
    createNew: createKnowledge,
  }));

  if (!me) return null;

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      <div
        ref={containerRef}
        className={`relative min-w-0 flex-1 overflow-y-auto p-4 ${hideListForEditor ? 'hidden md:block' : 'block'}`}
      >
        <BackgroundMark className="pointer-events-none absolute right-6 bottom-6 z-0 h-48 w-48 opacity-40" />
        <div className="relative z-10 mb-3 flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">ナレッジ</h1>
          <div className="flex items-center gap-2">
            <select
              value={sortMode}
              onChange={(e) => changeSortMode(e.target.value as SortMode)}
              title="並び順"
              className="rounded-md border border-neutral-200 bg-transparent p-1 text-xs dark:border-neutral-700"
            >
              <option value="updated">更新日順</option>
              <option value="title">タイトル順</option>
            </select>
            <KnowledgeFilterMenu
              open={filterMenuOpen}
              onToggle={() => setFilterMenuOpen((v) => !v)}
              onClose={() => setFilterMenuOpen(false)}
              allTags={allTags}
              tagFilter={tagFilter}
              onTagFilterChange={setTagFilter}
            />
            <button
              onClick={createKnowledge}
              className="flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900"
            >
              <Plus size={14} />
              新規作成
            </button>
          </div>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ナレッジを検索"
          className="relative z-10 mb-3 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-700"
        />

        <div className="relative z-10">
          {searchResults !== null ? (
            <div className="flex flex-col gap-1">
              {searchLoading && <p className="px-1 py-2 text-xs text-neutral-400">検索中...</p>}
              {!searchLoading && searchResults.length === 0 && (
                <p className="mt-6 text-center text-sm text-neutral-400">見つかりませんでした</p>
              )}
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => openKnowledge(r.id)}
                  className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <div className="font-medium">{r.title}</div>
                  <div className="truncate text-xs text-neutral-400">{r.snippet}</div>
                </button>
              ))}
            </div>
          ) : flattened.length === 0 ? (
            <p className="mt-10 text-center text-sm text-neutral-400">ナレッジはまだありません</p>
          ) : (
            grouped.map((group) => (
              <div key={group.category} className="mb-4">
                <h2 className="mb-1 px-1 text-xs font-semibold text-neutral-400">
                  {CATEGORY_LABELS[group.category]}
                </h2>
                <div className="flex flex-col gap-1">
                  {group.items.map((k) => {
                    const flatIndex = flattened.indexOf(k);
                    return (
                      <button
                        key={k.id}
                        data-knowledge-index={flatIndex}
                        onClick={() => {
                          setCursorIndex(flatIndex);
                          openKnowledge(k.id);
                        }}
                        className={`rounded-md px-2 py-1.5 text-left text-sm ${
                          flatIndex === cursorIndex
                            ? 'ring-2 ring-inset ring-blue-400'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <div className="truncate font-medium">{k.title}</div>
                        <div className="truncate text-xs text-neutral-400">
                          {k.description || <span className="text-neutral-300 dark:text-neutral-600">説明なし</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {displayedKnowledgeId && (
        <KnowledgeEditor
          key={editorGeneration}
          knowledgeId={displayedKnowledgeId}
          onClose={closeEditor}
          onOpenKnowledgeByTitle={openKnowledgeByTitle}
          closing={editorClosing}
        />
      )}
    </div>
  );
});
