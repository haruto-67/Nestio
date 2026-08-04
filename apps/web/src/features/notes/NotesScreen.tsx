import { useState } from 'react';
import { uuidv7 } from '@nestio/shared';
import { Plus, Pin } from 'lucide-react';
import { useApp } from '../../state/AppProvider.js';
import { useNotes } from '../../db/queries.js';
import { upsertNote } from '../../state/actions.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { NoteEditor } from './NoteEditor.js';

export function NotesScreen() {
  const { me } = useApp();
  const notes = useNotes();
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  if (!me) return null;
  const userId = me.id;

  const sorted = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return b.updated_at - a.updated_at;
  });

  const createNote = () => {
    const id = uuidv7();
    upsertNote(userId, id, { title: '', body: '', sort_order: nextSortOrder(notes) });
    setSelectedNoteId(id);
  };

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">メモ</h1>
          <button
            onClick={createNote}
            className="flex items-center gap-1 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900"
          >
            <Plus size={14} />
            新規メモ
          </button>
        </div>

        {sorted.length === 0 ? (
          <p className="mt-10 text-center text-sm text-neutral-400">メモはまだありません</p>
        ) : (
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
                <p className="flex-1 overflow-hidden text-xs whitespace-pre-wrap text-neutral-600">{note.body}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedNoteId && <NoteEditor noteId={selectedNoteId} onClose={() => setSelectedNoteId(null)} />}
    </div>
  );
}
