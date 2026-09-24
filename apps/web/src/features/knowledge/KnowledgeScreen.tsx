import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import type { KnowledgeCategory } from '@nestio/shared';
import { ChevronDown, ChevronRight, FileText, Folder, Plus, RefreshCw } from 'lucide-react';
import { vaultApi, type VaultNoteMeta, type VaultSearchHit, type VaultTree } from '../../api/vault.js';
import { ApiRequestError } from '../../api/client.js';
import { BackgroundMark } from '../../ui/BackgroundMark.js';
import { VaultNoteView } from './VaultNoteView.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from './categories.js';

/**
 * ナレッジ画面（改修25回目：Obsidianのメイン画面のような「Vaultのフォルダツリー＋md表示・編集」）。
 * データはVaultが正のため/vault APIから直接読む（docs/vault-spec.md 8章）。
 */

const COLLAPSED_KEY = 'nestio_vault_collapsed';
const SEARCH_DEBOUNCE_MS = 200;
const collator = new Intl.Collator(undefined, { numeric: true });

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
  /** ノート表示の開閉状態が変わった時に呼ばれる。Escでの一括クローズに使う */
  onEditorOpenChange?: (open: boolean) => void;
}

interface FolderNode {
  path: string;
  name: string;
  folders: FolderNode[];
  notes: VaultNoteMeta[];
}

function buildTree(tree: VaultTree): FolderNode {
  const root: FolderNode = { path: '', name: '', folders: [], notes: [] };
  const byPath = new Map<string, FolderNode>([['', root]]);
  const ensure = (p: string): FolderNode => {
    const existing = byPath.get(p);
    if (existing) return existing;
    const parentPath = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    const node: FolderNode = { path: p, name: p.slice(p.lastIndexOf('/') + 1), folders: [], notes: [] };
    ensure(parentPath).folders.push(node);
    byPath.set(p, node);
    return node;
  };
  for (const f of tree.folders) ensure(f);
  for (const n of tree.notes) {
    ensure(n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '').notes.push(n);
  }
  const sort = (node: FolderNode) => {
    node.folders.sort((a, b) => collator.compare(a.name, b.name));
    // フォルダと同名のハブノートを先頭に置く
    node.notes.sort((a, b) =>
      a.title === node.name ? -1 : b.title === node.name ? 1 : collator.compare(a.title, b.title),
    );
    node.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'Vaultに接続できませんでした（オフラインでは開いたことのあるノートだけ表示できます）';
}

export const KnowledgeScreen = forwardRef<KnowledgeScreenHandle, KnowledgeScreenProps>(function KnowledgeScreen(
  { onEditorOpenChange },
  ref,
) {
  const [tree, setTree] = useState<VaultTree | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VaultSearchHit[] | null>(null);
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const reloadTree = useCallback(async () => {
    try {
      setTree(await vaultApi.tree());
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reloadTree();
    // Obsidian・AI側での変更を拾うため、画面に戻ってきた時に読み直す
    const onFocus = () => void reloadTree();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reloadTree]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      vaultApi
        .search(trimmed)
        .then((res) => !cancelled && setSearchResults(res.notes))
        .catch(() => !cancelled && setSearchResults([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const root = useMemo(() => (tree ? buildTree(tree) : null), [tree]);

  // j/k移動・タイプアヘッド用に、表示中（折りたたまれていない）ノートを表示順に並べたもの
  const visibleNotes = useMemo(() => {
    if (searchResults) return searchResults as VaultNoteMeta[];
    const out: VaultNoteMeta[] = [];
    const walk = (node: FolderNode) => {
      if (node.path && collapsed.has(node.path)) return;
      out.push(...node.notes);
      node.folders.forEach(walk);
    };
    if (root) {
      root.folders.forEach(walk);
      out.push(...root.notes);
    }
    return out;
  }, [root, collapsed, searchResults]);

  useEffect(() => {
    containerRef.current?.querySelector(`[data-knowledge-index="${cursorIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursorIndex]);

  const toggleFolder = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // 保存できなくても折りたたみ自体は動く
      }
      return next;
    });
  };

  const openNote = (path: string) => {
    setSelectedPath(path);
    onEditorOpenChange?.(true);
    const idx = visibleNotes.findIndex((n) => n.path === path);
    if (idx >= 0) setCursorIndex(idx);
  };
  const closeEditor = () => {
    setSelectedPath(null);
    onEditorOpenChange?.(false);
  };

  const clampIndex = (i: number) => Math.min(Math.max(i, 0), Math.max(visibleNotes.length - 1, 0));

  useImperativeHandle(ref, () => ({
    moveCursor: (direction: -1 | 1) => setCursorIndex((i) => clampIndex(i + direction)),
    gotoFirst: () => setCursorIndex(0),
    gotoLast: () => setCursorIndex(clampIndex(visibleNotes.length - 1)),
    typeahead: (char: string) => {
      const lower = char.toLowerCase();
      const matches = visibleNotes
        .map((n, i) => ({ i, title: n.title }))
        .filter(({ title }) => title.toLowerCase().startsWith(lower));
      if (matches.length === 0) return;
      const next = matches.find((m) => m.i > cursorIndex) ?? matches[0];
      if (next) setCursorIndex(next.i);
    },
    activateCursor: () => {
      const n = visibleNotes[cursorIndex];
      if (n) openNote(n.path);
    },
    closeEditor,
    createNew: () => setCreating(true),
  }));

  const renderNoteButton = (n: VaultNoteMeta, depth: number) => {
    const index = visibleNotes.indexOf(n);
    const active = n.path === selectedPath;
    return (
      <button
        key={n.path}
        data-knowledge-index={index}
        data-vault-path={n.path}
        onClick={() => openNote(n.path)}
        title={n.description}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm ${
          index === cursorIndex ? 'ring-2 ring-inset ring-blue-400' : ''
        } ${active ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
      >
        <FileText size={14} className="shrink-0 text-neutral-400" />
        <span className="truncate">{n.title}</span>
      </button>
    );
  };

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const isCollapsed = collapsed.has(node.path);
    return (
      <div key={node.path}>
        <button
          onClick={() => toggleFolder(node.path)}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <Folder size={14} className="shrink-0 text-neutral-400" />
          <span className="truncate">{node.name}</span>
        </button>
        {!isCollapsed && (
          <>
            {node.notes.map((n) => renderNoteButton(n, depth + 1))}
            {node.folders.map((f) => renderFolder(f, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      <div
        ref={containerRef}
        className={`relative w-full shrink-0 overflow-y-auto border-neutral-200 p-3 md:w-72 md:border-r dark:border-neutral-800 ${
          selectedPath ? 'hidden md:block' : 'block'
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">ナレッジ</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void reloadTree()}
              title="Vaultを読み直す"
              className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => setCreating((v) => !v)}
              className="flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-sm text-white dark:bg-white dark:text-neutral-900"
            >
              <Plus size={14} />
              新規
            </button>
          </div>
        </div>

        {creating && tree && (
          <NewNoteForm
            folders={tree.folders}
            onCancel={() => setCreating(false)}
            onCreated={async (path) => {
              setCreating(false);
              await reloadTree();
              openNote(path);
            }}
          />
        )}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ナレッジを検索"
          className="mb-2 w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-neutral-700"
        />

        {loadError && <p className="px-1 py-2 text-xs text-red-500">{loadError}</p>}

        {searchResults !== null ? (
          <div className="flex flex-col gap-1">
            {searchResults.length === 0 && <p className="mt-6 text-center text-sm text-neutral-400">見つかりませんでした</p>}
            {searchResults.map((r, i) => (
              <button
                key={r.path}
                data-knowledge-index={i}
                onClick={() => openNote(r.path)}
                className={`rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  i === cursorIndex ? 'ring-2 ring-inset ring-blue-400' : ''
                }`}
              >
                <div className="font-medium">{r.title}</div>
                <div className="truncate text-xs text-neutral-400">{r.snippet}</div>
              </button>
            ))}
          </div>
        ) : root && root.folders.length === 0 && root.notes.length === 0 ? (
          <p className="mt-10 text-center text-sm text-neutral-400">ナレッジはまだありません</p>
        ) : (
          root && (
            <nav className="flex flex-col">
              {root.folders.map((f) => renderFolder(f, 0))}
              {root.notes.map((n) => renderNoteButton(n, 0))}
            </nav>
          )
        )}
      </div>

      <div className={`relative min-w-0 flex-1 overflow-y-auto ${selectedPath ? 'block' : 'hidden md:block'}`}>
        {selectedPath ? (
          <VaultNoteView
            key={selectedPath}
            path={selectedPath}
            onClose={closeEditor}
            onNavigate={openNote}
            onChanged={reloadTree}
            onMoved={async (to) => {
              await reloadTree();
              openNote(to);
            }}
            onDeleted={async () => {
              closeEditor();
              await reloadTree();
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <BackgroundMark className="pointer-events-none h-48 w-48 opacity-40" />
          </div>
        )}
      </div>
    </div>
  );
});

function NewNoteForm({
  folders,
  onCancel,
  onCreated,
}: {
  folders: string[];
  onCancel: () => void;
  onCreated: (path: string) => void | Promise<void>;
}) {
  const [folder, setFolder] = useState(folders.includes('topics') ? 'topics' : (folders[0] ?? ''));
  const [newFolder, setNewFolder] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('topic');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const dir = (folder === '__new__' ? newFolder : folder).trim().replace(/^\/+|\/+$/g, '');
    if (!title.trim() || !description.trim()) {
      setError('タイトルと説明（1行要約）は必須です');
      return;
    }
    try {
      const res = await vaultApi.create(`${dir ? `${dir}/` : ''}${title.trim()}.md`, description.trim(), category);
      await onCreated(res.path);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const field =
    'w-full rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-neutral-700';
  return (
    <form
      className="mb-3 flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-700"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <select value={folder} onChange={(e) => setFolder(e.target.value)} className={field}>
        <option value="">（ルート）</option>
        {folders.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        <option value="__new__">新しいフォルダ…</option>
      </select>
      {folder === '__new__' && (
        <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="例: projects/新プロジェクト" className={field} />
      )}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="タイトル（ファイル名）" className={field} autoFocus />
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="説明（1行要約）" className={field} />
      <select value={category} onChange={(e) => setCategory(e.target.value as KnowledgeCategory)} className={field}>
        {CATEGORY_ORDER.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-sm text-neutral-500">
          キャンセル
        </button>
        <button type="submit" className="rounded-md bg-neutral-900 px-2.5 py-1 text-sm text-white dark:bg-white dark:text-neutral-900">
          作成
        </button>
      </div>
    </form>
  );
}
