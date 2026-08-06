import { useState } from 'react';
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

/** contentEditableで保存されたHTMLからカード/一覧プレビュー用のプレーンテキストを取り出す */
function stripHtmlPreview(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? '').trim();
}

export function NotesScreen() {
  const { me } = useApp();
  const notes = useNotes();
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'gallery',
  );

  if (!me) return null;
  const userId = me.id;

  const sorted = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return b.updated_at - a.updated_at;
  });

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  const createNote = () => {
    const id = uuidv7();
    upsertNote(userId, id, { title: '', body: '', sort_order: nextSortOrder(notes) });
    setSelectedNoteId(id);
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <div className="relative flex-1 overflow-y-auto p-4">
        <BackgroundMark className="pointer-events-none absolute right-6 bottom-6 z-0 h-48 w-48 opacity-40" />
        <div className="relative z-10 mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">メモ</h1>
          <div className="flex items-center gap-2">
            <div className="flex rounded border border-neutral-200 dark:border-neutral-700">
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
              className="flex items-center gap-1 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900"
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {sorted.map((note) => (
                <button
                  key={note.id}
                  onClick={() => setSelectedNoteId(note.id)}
                  className="flex h-40 flex-col rounded-lg p-3 text-left shadow-sm"
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
              {sorted.map((note) => (
                <button
                  key={note.id}
                  onClick={() => setSelectedNoteId(note.id)}
                  className="flex flex-col rounded-lg p-4 text-left shadow-sm"
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

      {selectedNoteId && <NoteEditor noteId={selectedNoteId} onClose={() => setSelectedNoteId(null)} />}
    </div>
  );
}
