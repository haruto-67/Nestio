import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { uuidv7 } from '@nestio/shared';
import { FolderPlus, Plus, X, ChevronDown, ChevronRight, Pencil, Tag as TagIcon, GripVertical } from 'lucide-react';
import type { ListRow } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { useFolders, useLists, useTags } from '../../db/queries.js';
import { upsertFolder, deleteFolder, upsertList, deleteList, upsertTask } from '../../state/actions.js';
import { useTasks } from '../../db/queries.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { showToast } from '../../ui/toast.js';
import { SMART_LISTS, SMART_LIST_DOT_CLASS } from '../../lib/task-views.js';
import { loadCustomViews, deleteCustomView, subscribeCustomViews } from '../../lib/custom-views.js';
import { isCoarsePointerDevice } from '../../lib/pointer.js';
import { EditableLabel, type EditableLabelHandle } from './EditableLabel.js';
import type { ViewSelection } from '../../state/view.js';

const LIST_DRAG_TYPE = 'text/nestio-list-id';

interface SidebarProps {
  view: ViewSelection;
  onSelectView: (v: ViewSelection) => void;
  /** キーボードでのツリー移動（hキーで入る、改修10回目）が有効かどうか。矢印カーソルの表示に使う */
  focused?: boolean;
  /** リストの選択やEsc等、キーボードでのツリー移動から離脱する時に呼ばれる */
  onLeaveFocus?: () => void;
}

export interface SidebarHandle {
  moveCursor: (delta: number) => void;
  activateCursor: () => void;
}

interface TouchDragState {
  draggedId: string;
  overId: string | null;
  edge: 'before' | 'after' | null;
}

/** キーボードツリー移動(h→j/k→Enter)で辿れる項目。Sidebarの描画順と一致させる（改修10回目） */
type NavEntry =
  | { type: 'smart'; key: (typeof SMART_LISTS)[number]['key'] }
  | { type: 'custom'; id: string }
  | { type: 'list'; id: string }
  | { type: 'folder'; id: string };

export const Sidebar = forwardRef<SidebarHandle, SidebarProps>(function Sidebar(
  { view, onSelectView, focused = false, onLeaveFocus },
  ref,
) {
  const { me } = useApp();
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [customViews, setCustomViews] = useState(() => loadCustomViews());
  const allTags = useTags();
  // リストのグリップハンドルをタッチでドラッグする用の状態（改修9回目のフォローアップ）。
  // HTML5のネイティブDrag and Dropはタッチにほぼ対応していないため（改修7回目で判明した既知の
  // 制約）、ハンドルだけをPointer Eventsで独自にドラッグ実装する。ハンドル自体は小さく専用の
  // 当たり判定なので、タスク行のdraggable全面禁止（改修7回目）とは違い、ここだけタッチでも
  // ドラッグを有効化しても一覧のスクロールを阻害しない
  const [touchDrag, setTouchDrag] = useState<TouchDragState | null>(null);
  // 実際のドラッグ判定ロジックはstateではなくrefで持つ。連続するpointermoveがReactの
  // 再レンダーを待たずに矢継ぎ早に届いた場合、setTouchDragで更新した直後のstateを
  // クロージャ越しにまだ古い値のまま読んでしまい判定を取りこぼすことがあるため
  // （改修9回目フォローアップで発覚。stateは表示専用、refが判定の正）
  const touchDragRef = useRef<TouchDragState | null>(null);

  useEffect(() => subscribeCustomViews(() => setCustomViews(loadCustomViews())), []);

  const folders = [...useFolders()].sort((a, b) => a.sort_order - b.sort_order);
  const lists = useLists();
  const tasks = useTasks();

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

  // キーボードツリー移動用の辿れる項目一覧。JSXでの描画順（スマートリスト→カスタムビュー→
  // トップレベルのリスト→フォルダ（開いていれば中のリストも続けて））と必ず一致させる
  const entries: NavEntry[] = [
    ...SMART_LISTS.map((sl) => ({ type: 'smart' as const, key: sl.key })),
    ...customViews.map((cv) => ({ type: 'custom' as const, id: cv.id })),
    ...(listsByFolder.get(null) ?? []).map((l) => ({ type: 'list' as const, id: l.id })),
    ...folders.flatMap((f) => [
      { type: 'folder' as const, id: f.id },
      ...(openFolders.has(f.id)
        ? (listsByFolder.get(f.id) ?? []).map((l) => ({ type: 'list' as const, id: l.id }))
        : []),
    ]),
  ];
  const [cursorIndex, setCursorIndex] = useState(0);

  // hキーでフォーカスが入った瞬間、現在表示中のビューにカーソルを合わせる（無ければ先頭）
  useEffect(() => {
    if (!focused) return;
    const idx = entries.findIndex((e) => {
      if (e.type === 'smart') return view.type === 'smart' && view.key === e.key;
      if (e.type === 'custom') return view.type === 'custom' && view.id === e.id;
      if (e.type === 'list') return view.type === 'list' && view.listId === e.id;
      return false;
    });
    setCursorIndex(idx >= 0 ? idx : 0);
  }, [focused]);

  useImperativeHandle(ref, () => ({
    moveCursor: (delta: number) => {
      setCursorIndex((i) => Math.min(Math.max(i + delta, 0), entries.length - 1));
    },
    activateCursor: () => {
      const entry = entries[cursorIndex];
      if (!entry) return;
      if (entry.type === 'folder') {
        toggleFolder(entry.id);
        return;
      }
      if (entry.type === 'smart') onSelectView({ type: 'smart', key: entry.key });
      else if (entry.type === 'custom') onSelectView({ type: 'custom', id: entry.id });
      else onSelectView({ type: 'list', listId: entry.id });
      onLeaveFocus?.();
    },
  }));

  const cursorEntry = focused ? (entries[cursorIndex] ?? null) : null;
  const cursorRingClass = 'ring-2 ring-inset ring-blue-400';

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
  const changeListColor = (id: string, color: string) => upsertList(userId, id, { color });
  const removeList = (id: string) => {
    if (view.type === 'list' && view.listId === id) onSelectView({ type: 'smart', key: 'today' });
    deleteList(id);
  };

  // タスクをドラッグしてサイドバーのリストにドロップ→そのリストへ移動（最上位階層として）
  const dropTaskToList = (taskId: string, listId: string) => {
    const siblings = tasks.filter((t) => t.list_id === listId && t.parent_id === null);
    upsertTask(userId, taskId, { list_id: listId, parent_id: null, sort_order: nextSortOrder(siblings) });
    showToast('リストを移動しました');
  };

  // リストをドラッグして別のリストの上にドロップ→その位置へ並び替える（改修8回目。
  // 改修9回目でドロップ先の上半分/下半分どちらに離したかで挿入位置を前後に決められるよう拡張）。
  // ドロップ先が別フォルダに属する場合はそのフォルダへも移動する。sort_orderを1から振り直す
  // （既存コードにはドラッグでの「間に挿入する」並び替えの前例が無く、末尾追加のnextSortOrderでは
  // 対応できないため、影響を受けるフォルダ内の全リストを連番に再採番する方式にした）
  const reorderList = (draggedId: string, targetId: string, position: 'before' | 'after') => {
    if (draggedId === targetId) return;
    const dragged = lists.find((l) => l.id === draggedId);
    const target = lists.find((l) => l.id === targetId);
    if (!dragged || !target) return;

    const targetFolderId = target.folder_id;
    const siblings = (listsByFolder.get(targetFolderId) ?? []).filter((l) => l.id !== draggedId);
    const targetIdx = siblings.findIndex((l) => l.id === targetId);
    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1;
    const reordered = [...siblings];
    reordered.splice(insertIdx, 0, dragged);

    reordered.forEach((l, i) => {
      const sortOrder = i + 1;
      const fields: { sort_order: number; folder_id?: string | null } = { sort_order: sortOrder };
      if (l.id === draggedId) fields.folder_id = targetFolderId;
      if (l.sort_order !== sortOrder || l.folder_id !== targetFolderId) upsertList(userId, l.id, fields);
    });
  };

  // タッチでのリスト並び替え。グリップハンドルにPointer Captureをかけているため、
  // move/up はハンドル自身で発火し続ける。指の下に今どのリスト行があるかは
  // elementFromPointで都度判定する（data-list-row-id目印）
  const handleGripPointerDown = (e: ReactPointerEvent<HTMLSpanElement>, listId: string) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const next: TouchDragState = { draggedId: listId, overId: null, edge: null };
    touchDragRef.current = next;
    setTouchDrag(next);
  };

  const handleGripPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!touchDragRef.current) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-list-row-id]');
    if (!(target instanceof HTMLElement)) return;
    const overId = target.getAttribute('data-list-row-id');
    if (!overId) return;
    const rect = target.getBoundingClientRect();
    const edge: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const next: TouchDragState = { ...touchDragRef.current, overId, edge };
    touchDragRef.current = next;
    setTouchDrag(next);
  };

  const handleGripPointerUp = () => {
    const current = touchDragRef.current;
    if (current?.overId && current.overId !== current.draggedId && current.edge) {
      reorderList(current.draggedId, current.overId, current.edge);
    }
    touchDragRef.current = null;
    setTouchDrag(null);
  };

  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-neutral-50 text-sm dark:bg-neutral-950">
      <div className="flex flex-col gap-0.5 p-2">
        {SMART_LISTS.map((sl) => (
          <button
            key={sl.key}
            onClick={() => onSelectView({ type: 'smart', key: sl.key })}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left ${
              cursorEntry?.type === 'smart' && cursorEntry.key === sl.key ? cursorRingClass : ''
            } ${
              view.type === 'smart' && view.key === sl.key
                ? 'bg-blue-100 font-medium dark:bg-blue-900/40'
                : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SMART_LIST_DOT_CLASS[sl.key]}`} />
            {sl.label}
          </button>
        ))}
        {customViews.map((cv) => (
          <div
            key={cv.id}
            className={`group flex items-center gap-2 rounded px-2 ${
              cursorEntry?.type === 'custom' && cursorEntry.id === cv.id ? cursorRingClass : ''
            } ${
              view.type === 'custom' && view.id === cv.id
                ? 'bg-blue-100 font-medium dark:bg-blue-900/40'
                : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
            }`}
          >
            <button
              onClick={() => onSelectView({ type: 'custom', id: cv.id })}
              className="flex flex-1 items-center gap-2 py-1.5 text-left"
            >
              <TagIcon size={12} className="shrink-0 text-neutral-400" />
              <span className="truncate">{cv.name}</span>
              <span className="shrink-0 text-[10px] text-neutral-400">
                {cv.tagIds
                  .map((id) => allTags.find((t) => t.id === id)?.name)
                  .filter(Boolean)
                  .join('+')}
              </span>
            </button>
            <button
              onClick={() => {
                if (view.type === 'custom' && view.id === cv.id) onSelectView({ type: 'smart', key: 'today' });
                deleteCustomView(cv.id);
              }}
              title="このカスタムビューを削除"
              className="hidden min-h-8 min-w-8 items-center justify-center text-neutral-400 hover:text-red-500 group-hover:flex"
            >
              <X size={12} />
            </button>
          </div>
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
            cursorHighlighted={cursorEntry?.type === 'list' && cursorEntry.id === l.id}
            onSelect={() => onSelectView({ type: 'list', listId: l.id })}
            onRename={(name) => renameList(l.id, name)}
            onDelete={() => removeList(l.id)}
            onChangeColor={(color) => changeListColor(l.id, color)}
            onDropTask={(taskId) => dropTaskToList(taskId, l.id)}
            listId={l.id}
            onDropList={(draggedId, position) => reorderList(draggedId, l.id, position)}
            onGripPointerDown={(e) => handleGripPointerDown(e, l.id)}
            onGripPointerMove={handleGripPointerMove}
            onGripPointerUp={handleGripPointerUp}
            touchDragEdge={touchDrag?.overId === l.id ? touchDrag.edge : null}
            isBeingTouchDragged={touchDrag?.draggedId === l.id}
          />
        ))}

        {folders.map((f) => {
          const labelRef = { current: null as EditableLabelHandle | null };
          return (
          <div key={f.id}>
            <div
              className={`flex items-center gap-0.5 rounded px-1 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-800 ${
                cursorEntry?.type === 'folder' && cursorEntry.id === f.id ? cursorRingClass : ''
              }`}
            >
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
                    cursorHighlighted={cursorEntry?.type === 'list' && cursorEntry.id === l.id}
                    onSelect={() => onSelectView({ type: 'list', listId: l.id })}
                    onRename={(name) => renameList(l.id, name)}
                    onDelete={() => removeList(l.id)}
                    onChangeColor={(color) => changeListColor(l.id, color)}
                    onDropTask={(taskId) => dropTaskToList(taskId, l.id)}
                    listId={l.id}
                    onDropList={(draggedId, position) => reorderList(draggedId, l.id, position)}
                    onGripPointerDown={(e) => handleGripPointerDown(e, l.id)}
                    onGripPointerMove={handleGripPointerMove}
                    onGripPointerUp={handleGripPointerUp}
                    touchDragEdge={touchDrag?.overId === l.id ? touchDrag.edge : null}
                    isBeingTouchDragged={touchDrag?.draggedId === l.id}
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
});

const LIST_COLORS = [
  '#888888',
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#0EA5E9',
  '#6366F1',
  '#EC4899',
  // アーストーン系（改修4回目 UI改善案7。パレットが崩れない範囲で控えめに追加）
  '#B5651D', // テラコッタ
  '#6B8E23', // モスグリーン
  '#C2A878', // サンド
  '#7C6A46', // オリーブブラウン
];

function ListRow({
  listId,
  name,
  color,
  active,
  cursorHighlighted = false,
  onSelect,
  onRename,
  onDelete,
  onChangeColor,
  onDropTask,
  onDropList,
  onGripPointerDown,
  onGripPointerMove,
  onGripPointerUp,
  touchDragEdge,
  isBeingTouchDragged,
}: {
  listId: string;
  name: string;
  color: string;
  active: boolean;
  cursorHighlighted?: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onChangeColor: (color: string) => void;
  onDropTask: (taskId: string) => void;
  onDropList: (draggedListId: string, position: 'before' | 'after') => void;
  onGripPointerDown: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onGripPointerMove: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onGripPointerUp: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  touchDragEdge: 'before' | 'after' | null;
  isBeingTouchDragged: boolean;
}) {
  const labelRef = useRef<EditableLabelHandle | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [taskDragOver, setTaskDragOver] = useState(false);
  // リスト並び替え時、ドロップ先の上半分/下半分どちらに離したかで挿入位置（前/後）を示す線
  // （改修9回目：行全体をハイライトするだけでは挿入位置が分かりにくいという指摘への対応）
  const [listDragEdge, setListDragEdge] = useState<'before' | 'after' | null>(null);
  // マウスのネイティブDnD（listDragEdge）とタッチの自前ドラッグ（touchDragEdge）のどちらか
  // 有効な方の挿入線を表示する
  const effectiveDragEdge = listDragEdge ?? touchDragEdge;
  return (
    <div
      ref={rowRef}
      data-list-row-id={listId}
      onClick={onSelect}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(LIST_DRAG_TYPE)) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setListDragEdge(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
          return;
        }
        if (e.dataTransfer.types.includes('text/nestio-task-id')) {
          e.preventDefault();
          setTaskDragOver(true);
        }
      }}
      onDragLeave={() => {
        setTaskDragOver(false);
        setListDragEdge(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setTaskDragOver(false);
        if (e.dataTransfer.types.includes(LIST_DRAG_TYPE)) {
          const draggedListId = e.dataTransfer.getData(LIST_DRAG_TYPE);
          if (draggedListId) onDropList(draggedListId, listDragEdge ?? 'before');
          setListDragEdge(null);
          return;
        }
        const taskId = e.dataTransfer.getData('text/nestio-task-id');
        if (taskId) onDropTask(taskId);
      }}
      className={`relative flex cursor-pointer items-center gap-1 rounded px-1 py-1 select-none [-webkit-touch-callout:none] ${
        isBeingTouchDragged ? 'opacity-40' : ''
      } ${cursorHighlighted ? 'ring-2 ring-inset ring-blue-400' : ''} ${
        taskDragOver
          ? 'bg-blue-100 dark:bg-blue-900/40'
          : active
            ? 'bg-blue-100 font-medium dark:bg-blue-900/40'
            : 'hover:bg-neutral-200 dark:hover:bg-neutral-800'
      }`}
    >
      {effectiveDragEdge && (
        <div
          className={`absolute inset-x-1 h-0.5 rounded-full bg-blue-500 ${effectiveDragEdge === 'before' ? '-top-0.5' : '-bottom-0.5'}`}
        />
      )}
      {/* リストの並び替え用グリップハンドル（改修8回目）。ここだけをdraggableにすることで
          行全体のドラッグ operationとは分離し、タッチ環境ではisCoarsePointerDeviceで
          draggable自体を外してスクロール阻害を避ける（改修7回目で確立したパターンを踏襲）。
          ドラッグ中に見せる画像（setDragImage）は行全体にし、つまんでいるのはハンドルだけでも
          見た目には行全体が追従しているように見せる（改修9回目：ハンドルの小さいアイコンだけが
          追従して分かりにくいという指摘への対応）。
          タッチではHTML5 DnDのdraggableをそもそも無効化しているため（上記コメントの理由）
          並び替え自体ができなくなっていた。ハンドルだけPointer Eventsで独自にドラッグを実装し、
          タッチでも並び替えできるようにする（改修9回目フォローアップ）。touch-noneで
          ブラウザ標準のスクロールジェスチャーと衝突しないようにする */}
      <span
        draggable={!isCoarsePointerDevice()}
        onDragStart={(e) => {
          e.dataTransfer.setData(LIST_DRAG_TYPE, listId);
          e.dataTransfer.effectAllowed = 'move';
          if (rowRef.current) {
            const rect = rowRef.current.getBoundingClientRect();
            e.dataTransfer.setDragImage(rowRef.current, e.clientX - rect.left, e.clientY - rect.top);
          }
        }}
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
        onClick={(e) => e.stopPropagation()}
        title="ドラッグして並び替え"
        className="flex min-h-8 min-w-6 shrink-0 cursor-grab touch-none items-center justify-center text-neutral-300 hover:text-neutral-500 active:cursor-grabbing dark:text-neutral-600 dark:hover:text-neutral-400"
      >
        <GripVertical size={13} />
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowColorPicker((v) => !v);
        }}
        title="色を変更"
        className="flex min-h-8 min-w-8 shrink-0 items-center justify-center"
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      </button>
      {showColorPicker && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-full left-0 z-10 mt-1 flex w-44 flex-wrap gap-1 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          {LIST_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                onChangeColor(c);
                setShowColorPicker(false);
              }}
              className={`h-6 w-6 rounded-full border-2 ${
                color === c ? 'border-blue-400' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
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
