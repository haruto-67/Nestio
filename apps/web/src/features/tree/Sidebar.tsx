import { useState, useRef } from 'react';
import { uuidv7 } from '@nestio/shared';
import { FolderPlus, Plus, X, ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { useApp } from '../../state/AppProvider.js';
import { useFolders, useLists } from '../../db/queries.js';
import { upsertFolder, deleteFolder, upsertList, deleteList } from '../../state/actions.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { SMART_LISTS } from '../../lib/task-views.js';
import { EditableLabel, type EditableLabelHandle } from './EditableLabel.js';
import type { ViewSelection } from '../../state/view.js';

interface SidebarProps {
  view: ViewSelection;
  onSelectView: (v: ViewSelection) => void;
}

export function Sidebar({ view, onSelectView }: SidebarProps) {
  const { me } = useApp();
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const folders = [...useFolders()].sort((a, b) => a.sort_order - b.sort_order);
  const lists = useLists();

  const listsByFolder = new Map<string | null, typeof lists>();
  for (const l of lists) {
    const key = l.folder_id;
    const bucket = listsByFolder.get(key);
    if (bucket) bucket.push(l);
    else listsByFolder.set(key, [l]);
  }
  for (const bucket of listsByFolder.values()) bucket.sort((a, b) => a.sort_order - b.sort_order);

  const toggleFolder = (id: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!me) return null;
  const userId = me.id;

  const createFolder = () => {
    const id = uuidv7();
    upsertFolder(userId, id, { name: '新しいフォルダ', sort_order: nextSortOrder(folders) });
    setOpenFolders((prev) => new Set(prev).add(id));
  };

  const createList = (folderId: string | null) => {
    const id = uuidv7();
    const siblings = listsByFolder.get(folderId) ?? [];
    upsertList(userId, id, { name: '新しいリスト', folder_id: folderId, sort_order: nextSortOrder(siblings) });
    onSelectView({ type: 'list', listId: id });
  };

  const renameFolder = (id: string, name: string) => upsertFolder(userId, id, { name });
  const removeFolder = (id: string) => deleteFolder(id);
  const renameList = (id: string, name: string) => upsertList(userId, id, { name });
  const removeList = (id: string) => {
    if (view.type === 'list' && view.listId === id) onSelectView({ type: 'smart', key: 'today' });
    deleteList(id);
  };

  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-neutral-50 text-sm dark:bg-neutral-950">
      <div className="flex flex-col gap-0.5 p-2">
        {SMART_LISTS.map((sl) => (
          <button
            key={sl.key}
            onClick={() => onSelectView({ type: 'smart', key: sl.key })}
            className={`rounded px-2 py-1.5 text-left ${
              view.type === 'smart' && view.key === sl.key
                ? 'bg-blue-100 font-medium dark:bg-blue-900/40'
                : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            {sl.label}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between px-3 text-xs font-semibold uppercase text-neutral-400">
        <span>リスト</span>
        <div className="flex gap-1">
          <button
            onClick={createFolder}
            title="フォルダを追加"
            className="flex min-h-8 min-w-8 items-center justify-center hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <FolderPlus size={15} />
          </button>
          <button
            onClick={() => createList(null)}
            title="リストを追加"
            className="flex min-h-8 min-w-8 items-center justify-center hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 p-2">
        {(listsByFolder.get(null) ?? []).map((l) => (
          <ListRow
            key={l.id}
            name={l.name}
            color={l.color}
            active={view.type === 'list' && view.listId === l.id}
            onSelect={() => onSelectView({ type: 'list', listId: l.id })}
            onRename={(name) => renameList(l.id, name)}
            onDelete={() => removeList(l.id)}
          />
        ))}

        {folders.map((f) => {
          const labelRef = { current: null as EditableLabelHandle | null };
          return (
          <div key={f.id}>
            <div className="flex items-center gap-0.5 rounded px-1 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800">
              <button
                onClick={() => toggleFolder(f.id)}
                className="flex min-h-8 min-w-6 items-center justify-center text-neutral-400"
              >
                {openFolders.has(f.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <EditableLabel
                ref={(el) => {
                  labelRef.current = el;
                }}
                value={f.name}
                className="flex-1 truncate px-1"
                onCommit={(name) => renameFolder(f.id, name)}
              />
              <button
                onClick={() => labelRef.current?.startEditing()}
                title="名前を変更"
                className="flex min-h-8 min-w-8 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => createList(f.id)}
                title="リストを追加"
                className="flex min-h-8 min-w-8 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => removeFolder(f.id)}
                title="フォルダを削除"
                className="flex min-h-8 min-w-8 items-center justify-center text-neutral-400 hover:text-red-500"
              >
                <X size={14} />
              </button>
            </div>
            {openFolders.has(f.id) && (
              <div className="ml-4 flex flex-col gap-0.5">
                {(listsByFolder.get(f.id) ?? []).map((l) => (
                  <ListRow
                    key={l.id}
                    name={l.name}
                    color={l.color}
                    active={view.type === 'list' && view.listId === l.id}
                    onSelect={() => onSelectView({ type: 'list', listId: l.id })}
                    onRename={(name) => renameList(l.id, name)}
                    onDelete={() => removeList(l.id)}
                  />
                ))}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </nav>
  );
}

function ListRow({
  name,
  color,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  name: string;
  color: string;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const labelRef = useRef<EditableLabelHandle | null>(null);
  return (
    <div
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-1 rounded px-1 py-1 ${
        active ? 'bg-blue-100 font-medium dark:bg-blue-900/40' : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
      }`}
    >
      <span className="ml-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <EditableLabel ref={labelRef} value={name} className="flex-1 truncate px-1" onCommit={onRename} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          labelRef.current?.startEditing();
        }}
        title="名前を変更"
        className="flex min-h-8 min-w-8 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        <Pencil size={13} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="リストを削除"
        className="flex min-h-8 min-w-8 items-center justify-center text-neutral-400 hover:text-red-500"
      >
        <X size={14} />
      </button>
    </div>
  );
}
