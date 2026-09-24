import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { KnowledgeCategory } from '@nestio/shared';
import { ArrowLeft, Pencil, Trash2, FolderInput } from 'lucide-react';
import { vaultApi, type VaultNote } from '../../api/vault.js';
import { ApiRequestError } from '../../api/client.js';
import { showToast } from '../../ui/toast.js';
import { renderVaultMarkdown } from './render-markdown.js';
import { CATEGORY_LABELS } from './categories.js';

interface Props {
  path: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onChanged: () => void | Promise<void>;
  onMoved: (to: string) => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}

/**
 * Vaultのノート1件の表示とソース編集（改修25回目）。
 * 表示はfrontmatterをプロパティ欄として本文の上に出し、本文はMarkdownをレンダリングする。
 * 編集はfrontmatter込みのMarkdownソースを直接書き換える（2026-09-24 ユーザー決定）。
 * 保存時は読み込んだ時点のversionを送り、Obsidian・AI側で更新されていれば409で止める。
 */
export function VaultNoteView({ path, onClose, onNavigate, onChanged, onMoved, onDeleted }: Props) {
  const [note, setNote] = useState<VaultNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setNote(await vaultApi.note(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'ノートを読み込めませんでした');
    }
  };

  // pathが変わるたびに読み直す（親がkey={path}で作り直すため、実質マウント時の1回）
  useEffect(() => {
    void load();
  }, [path]);

  const html = useMemo(
    () => (note ? renderVaultMarkdown(note.body, { attachmentUrl: vaultApi.attachmentUrl }) : ''),
    [note],
  );

  const onBodyClick = async (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest<HTMLElement>('a.wikilink');
    if (!link) return;
    e.preventDefault();
    const title = link.dataset.wikilink ?? '';
    try {
      const res = await vaultApi.resolve(title);
      if (res.path) onNavigate(res.path);
      else showToast(`「${title}」はまだありません`);
    } catch {
      showToast('リンク先を解決できませんでした');
    }
  };

  const save = async () => {
    if (!note || draft === null) return;
    setSaving(true);
    try {
      await vaultApi.save(note.path, draft, note.version);
      setDraft(null);
      setConflict(false);
      await load();
      await onChanged();
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) setConflict(true);
      else showToast(e instanceof ApiRequestError ? e.message : '保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const move = async () => {
    if (!note) return;
    const to = window.prompt('移動先のパス（ファイル名＝タイトル。リンクは自動で書き換わります）', note.path);
    if (!to || to === note.path) return;
    try {
      const res = await vaultApi.move(note.path, to, note.version);
      if (res.rewritten.length > 0) showToast(`${res.rewritten.length}件のノートのリンクを書き換えました`);
      await onMoved(res.path);
    } catch (e) {
      showToast(e instanceof ApiRequestError ? e.message : '移動できませんでした');
    }
  };

  const remove = async () => {
    if (!note || !window.confirm(`「${note.title}」を削除しますか？（Vaultの.trashへ移動します）`)) return;
    try {
      await vaultApi.remove(note.path, note.version);
      showToast(`「${note.title}」を.trashへ移動しました`);
      await onDeleted();
    } catch (e) {
      showToast(e instanceof ApiRequestError ? e.message : '削除できませんでした');
    }
  };

  const iconButton = 'rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800';

  return (
    <div className="mx-auto max-w-3xl px-4 py-3 md:px-8">
      <div className="mb-2 flex items-center gap-1">
        <button onClick={onClose} className={`${iconButton} md:hidden`} title="一覧へ戻る">
          <ArrowLeft size={16} />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">{note?.path ?? path}</span>
        {note && draft === null && (
          <>
            <button onClick={() => setDraft(note.content)} className={iconButton} title="編集">
              <Pencil size={15} />
            </button>
            <button onClick={() => void move()} className={iconButton} title="移動・リネーム">
              <FolderInput size={15} />
            </button>
            <button onClick={() => void remove()} className={iconButton} title="削除">
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>

      {error && <p className="py-6 text-sm text-red-500">{error}</p>}

      {note && draft !== null && (
        <div className="flex flex-col gap-2">
          {conflict && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              このノートは読み込んだ後にObsidianかAIで更新されています。上書きはしていません。
              編集内容を控えてから「最新を読み込む」を押してください。
              <button
                onClick={() => {
                  setConflict(false);
                  setDraft(null);
                  void load();
                }}
                className="ml-2 underline"
              >
                最新を読み込む（編集内容は破棄）
              </button>
            </div>
          )}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-[60vh] w-full rounded-md border border-neutral-200 bg-transparent p-3 font-mono text-sm leading-relaxed outline-none focus:border-blue-400 dark:border-neutral-700"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setDraft(null);
                setConflict(false);
              }}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-500"
            >
              キャンセル
            </button>
            <button
              onClick={() => void save()}
              disabled={saving || conflict}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}

      {note && draft === null && (
        <article>
          <h1 className="mb-2 text-2xl font-bold">{note.title}</h1>
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-neutral-50 p-2 text-xs dark:bg-neutral-900">
            <dt className="text-neutral-400">説明</dt>
            <dd>{note.description || <span className="text-neutral-400">なし</span>}</dd>
            <dt className="text-neutral-400">カテゴリ</dt>
            <dd>{CATEGORY_LABELS[note.category as KnowledgeCategory] ?? (note.category || 'なし')}</dd>
            {note.tags.length > 0 && (
              <>
                <dt className="text-neutral-400">タグ</dt>
                <dd className="flex flex-wrap gap-1">
                  {note.tags.map((t) => (
                    <span key={t} className="rounded bg-neutral-200 px-1.5 dark:bg-neutral-700">
                      {t}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
          <div className="vault-md" onClick={(e) => void onBodyClick(e)} dangerouslySetInnerHTML={{ __html: html }} />
          {note.backlinks.length > 0 && (
            <section className="mt-8 border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <h2 className="mb-1 text-xs font-semibold text-neutral-400">バックリンク</h2>
              <ul className="flex flex-col gap-0.5">
                {note.backlinks.map((b) => (
                  <li key={b.path}>
                    <button onClick={() => onNavigate(b.path)} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                      {b.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      )}
    </div>
  );
}
