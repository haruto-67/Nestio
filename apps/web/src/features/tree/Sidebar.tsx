import { useState } from 'react';
import { uuidv7 } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { upsertFolderOp, deleteFolderOp, upsertListOp, deleteListOp } from '../../state/actions.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { SMART_LISTS } from '../../lib/task-views.js';
import { EditableLabel } from './EditableLabel.js';
import type { ViewSelection } from '../../state/view.js';

interface SidebarProps {
  view: ViewSelection;
  onSelectView: (v: ViewSelection) => void;
}

export function Sidebar({ view, onSelectView }: SidebarProps) {
  const { data, submitOps } = useApp();
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  const folders = [...data.folders.values()].sort((a, b) => a.sort_order - b.sort_order);
  const lists = [...data.lists.values()];

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

  const report = (err: unknown) => {
    console.error(err);
  };

  const createFolder = () => {
    const id = uuidv7();
    submitOps([upsertFolderOp(id, { name: '新しいフォルダ', sort_order: nextSortOrder(folders) })]).catch(report);
    setOpenFolders((prev) => new Set(prev).add(id));
  };

  const createList = (folderId: string | null) => {
    const id = uuidv7();
    const siblings = listsByFolder.get(folderId) ?? [];
    submitOps([
      upsertListOp(id, { name: '新しいリスト', folder_id: folderId, sort_order: nextSortOrder(siblings) }),
    ])
      .then(() => onSelectView({ type: 'list', listId: id }))
      .catch(report);
  };

  const renameFolder = (id: string, name: string) => submitOps([upsertFolderOp(id, { name })]).catch(report);
  const removeFolder = (id: string) => submitOps([deleteFolderOp(id)]).catch(report);
  const renameList = (id: string, name: string) => submitOps([upsertListOp(id, { name })]).catch(report);
  const removeList = (id: string) => {
    if (view.type === 'list' && view.listId === id) onSelectView({ type: 'smart', key: 'today' });
    submitOps([deleteListOp(id)]).catch(report);
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
        <div className="flex gap-2">
          <button onClick={createFolder} title="フォルダを追加" className="hover:text-neutral-700 dark:hover:text-neutral-200">
            📁+
          </button>
          <button onClick={() => createList(null)} title="リストを追加" className="hover:text-neutral-700 dark:hover:text-neutral-200">
            +
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

        {folders.map((f) => (
          <div key={f.id}>
            <div className="group flex items-center gap-1 rounded px-2 py-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-800">
              <button onClick={() => toggleFolder(f.id)} className="w-4 text-xs">
                {openFolders.has(f.id) ? '▾' : '▸'}
              </button>
              <EditableLabel value={f.name} className="flex-1 truncate" onCommit={(name) => renameFolder(f.id, name)} />
              <button onClick={() => createList(f.id)} className="hidden text-xs group-hover:inline">
                +
              </button>
              <button onClick={() => removeFolder(f.id)} className="hidden text-xs text-red-500 group-hover:inline">
                ✕
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
        ))}
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
  return (
    <div
      onClick={onSelect}
      className={`group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 ${
        active ? 'bg-blue-100 font-medium dark:bg-blue-900/40' : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
      }`}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <EditableLabel value={name} className="flex-1 truncate" onCommit={onRename} />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="hidden text-xs text-red-500 group-hover:inline"
      >
        ✕
      </button>
    </div>
  );
}
