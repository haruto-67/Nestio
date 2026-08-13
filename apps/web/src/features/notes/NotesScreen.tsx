import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { uuidv7 } from '@nestio/shared';
import { Plus, Pin, LayoutGrid, List as ListIcon } from 'lucide-react';
import { useApp } from '../../state/AppProvider.js';
import { useNotes } from '../../db/queries.js';
import { upsertNote } from '../../state/actions.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { NoteEditor } from './NoteEditor.js';
import { BackgroundMark } from '../../ui/BackgroundMark.js';

type ViewMode = 'gallery' | 'list';
const VIEW_MODE_KEY = 'nestio_notes_view_mode';

export interface NotesScreenHandle {
  moveCursor: (direction: -1 | 1) => void;
  activateCursor: () => void;
  gotoFirst: () => void;
  gotoLast: () => void;
  typeahead: (char: string) => void;
  closeEditor: () => void;
}

export interface NotesScreenProps {
  colorFilter: string | null;
  /** メモ詳細(NoteEditor)の開閉状態が変わった時に呼ばれる。Escでの一括クローズに使う（改修11回目） */
  onEditorOpenChange?: (open: boolean) => void;
}

/** contentEditableで保存されたHTMLからカード/一覧プレビュー用のプレーンテキストを取り出す */
function stripHtmlPreview(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? '').trim();
}

export const NotesScreen = forwardRef<NotesScreenHandle, NotesScreenProps>(function NotesScreen(
  { colorFilter, onEditorOpenChange },
  ref,
) {
  const { me } = useApp();
  const notes = useNotes();
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'gallery',
  );
  // j/k（move_up/move_down）でメモ一覧をカーソル移動できるようにする（改修10回目）。
  // 選択中(selectedNoteId、エディタが開いているか)とは別に持ち、エディタを閉じてもカーソル位置を保つ
  const [cursorIndex, setCursorIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  // ギャラリー表示は複数列のグリッドなので、j/k（上下）は列数ぶんインデックスを進めないと
  // 見た目上の上下移動にならない（改修11回目：斜めに飛んで使いづらいという指摘の修正）。
  // 列数はTailwindのgrid-cols-*がブレークポイントで変わるため、実際のcomputed styleから測る
  const [columns, setColumns] = useState(1);

  const filtered = colorFilter === null ? notes : notes.filter((n) => n.color === colorFilter);
  const sorted = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return b.updated_at - a.updated_at;
  });

  useEffect(() => {
    if (viewMode !== 'gallery') {
      setColumns(1);
      return;
    }
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const count = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
      setColumns(Math.max(1, count));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, sorted.length]);

  // カーソルが画面外に出ないよう追従スクロールする（改修11回目）
  useEffect(() => {
    containerRef.current?.querySelector(`[data-note-index="${cursorIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursorIndex]);

  const openNote = (id: string) => {
    setSelectedNoteId(id);
    onEditorOpenChange?.(true);
  };
  const closeEditor = () => {
    setSelectedNoteId(null);
    onEditorOpenChange?.(false);
  };

  const clampIndex = (i: number) => Math.min(Math.max(i, 0), Math.max(sorted.length - 1, 0));

  useImperativeHandle(ref, () => ({
    moveCursor: (direction: -1 | 1) => {
      const step = viewMode === 'gallery' ? columns : 1;
      setCursorIndex((i) => clampIndex(i + direction * step));
    },
    gotoFirst: () => setCursorIndex(0),
    gotoLast: () => setCursorIndex(clampIndex(sorted.length - 1)),
    typeahead: (char: string) => {
      const lower = char.toLowerCase();
      const matches = sorted
        .map((note, i) => ({ i, title: note.title }))
        .filter(({ title }) => title.toLowerCase().startsWith(lower));
      if (matches.length === 0) return;
      const next = matches.find((m) => m.i > cursorIndex) ?? matches[0];
      if (next) setCursorIndex(next.i);
    },
    activateCursor: () => {
      const note = sorted[cursorIndex];
      if (note) openNote(note.id);
    },
    closeEditor,
  }));

  if (!me) return null;
  const userId = me.id;

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const createNote = () => {
    const id = uuidv7();
    upsertNote(userId, id, { title: '', body: '', sort_order: nextSortOrder(notes) });
    openNote(id);
  };

  const selectByClick = (i: number, id: string) => {
    setCursorIndex(i);
    openNote(id);
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* メモ詳細が開いている間、モバイル幅では一覧を隠して詳細に画面を譲る
          （改修11回目フォローアップ：TaskListView/TaskDetailAreaと同じ不具合がメモにもあった） */}
      <div
        ref={containerRef}
        className={`relative flex-1 overflow-y-auto p-4 ${selectedNoteId ? 'hidden md:block' : 'block'}`}
      >
        <BackgroundMark className="pointer-events-none absolute right-6 bottom-6 z-0 h-48 w-48 opacity-40" />
        <div className="relative z-10 mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">メモ</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-neutral-200 dark:border-neutral-700">
              <button
                onClick={() => changeViewMode('gallery')}
                title="ギャラリー表示"
                className={`flex h-7 w-7 items-center justify-center ${viewMode === 'gallery' ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-400'}`}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => changeViewMode('list')}
                title="リスト表示"
                className={`flex h-7 w-7 items-center justify-center ${viewMode === 'list' ? 'bg-neutral-200 dark:bg-neutral-700' : 'text-neutral-400'}`}
              >
                <ListIcon size={14} />
              </button>
            </div>
            <button
              onClick={createNote}
              className="flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900"
            >
              <Plus size={14} />
              新規メモ
            </button>
          </div>
        </div>

        <div className="relative z-10">
          {sorted.length === 0 ? (
            <p className="mt-10 text-center text-sm text-neutral-400">メモはまだありません</p>
          ) : viewMode === 'gallery' ? (
            <div ref={gridRef} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {sorted.map((note, i) => (
                <button
                  key={note.id}
                  data-note-index={i}
                  onClick={() => selectByClick(i, note.id)}
                  className={`flex h-40 flex-col rounded-xl p-3 text-left shadow-sm ${
                    i === cursorIndex ? 'ring-2 ring-inset ring-blue-400' : ''
                  }`}
                  style={{ backgroundColor: note.color }}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="truncate text-sm font-medium text-neutral-800">{note.title || '無題'}</span>
                    {note.pinned === 1 && <Pin size={12} className="text-amber-600" />}
                  </div>
                  <p className="flex-1 overflow-hidden text-xs whitespace-pre-wrap text-neutral-600">
                    {stripHtmlPreview(note.body)}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            // ギャラリー表示のカードをそのまま横長にしたような見た目にする（改修7回目。
            // 以前はタスク一覧のような細い行＋色ドットで、ギャラリー表示との一体感が無かった）
            <div className="flex flex-col gap-2">
              {sorted.map((note, i) => (
                <button
                  key={note.id}
                  data-note-index={i}
                  onClick={() => selectByClick(i, note.id)}
                  className={`flex flex-col rounded-xl p-4 text-left shadow-sm ${
                    i === cursorIndex ? 'ring-2 ring-inset ring-blue-400' : ''
                  }`}
                  style={{ backgroundColor: note.color }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-base font-semibold text-neutral-800">{note.title || '無題'}</span>
                    {note.pinned === 1 && <Pin size={14} className="shrink-0 text-amber-600" />}
                  </div>
                  <p className="mt-1 truncate text-sm text-neutral-600">{stripHtmlPreview(note.body)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedNoteId && <NoteEditor noteId={selectedNoteId} onClose={closeEditor} />}
    </div>
  );
});
