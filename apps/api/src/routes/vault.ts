import fs from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { detectImageMime } from '../attachments/magic-bytes.js';
import { vaultForUser, type VaultStore } from '../vault/store.js';
import { VaultError } from '../vault/paths.js';

/**
 * ナレッジVaultのWeb UI用API（改修25回目、docs/vault-spec.md 8章）。
 * ナレッジはVaultのmdファイルが正で/syncの対象外のため、CLAUDE.md「絶対に守ること」2・4の例外として
 * UIはこのAPIで直接読み書きする（2026-09-24 ユーザー承認）。書き込みは必ずversionを受け取り、
 * Obsidian・AI側の変更を無言で上書きしない。
 */
export const vaultRoute = new Hono<{ Variables: AppVariables }>();

vaultRoute.use('/vault/*', requireAuth);

const VAULT_ERROR_TO_API = {
  not_found: 'not_found',
  conflict: 'conflict',
  invalid: 'validation_failed',
  exists: 'conflict',
} as const;

function withVault<T>(c: { get: (k: 'userId' | 'env') => unknown }, fn: (vault: VaultStore) => T): T {
  const userId = c.get('userId') as string | undefined;
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  const env = c.get('env') as { VAULT_DIR: string };
  try {
    return fn(vaultForUser(env.VAULT_DIR, userId));
  } catch (e) {
    if (e instanceof VaultError) throw new ApiError(VAULT_ERROR_TO_API[e.code], e.message, { vault_error: e.code });
    throw e;
  }
}

async function parseBody<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError('validation_failed', '入力が不正です');
  return parsed.data;
}

/** フォルダ一覧と全ノートの索引（本文なし） */
vaultRoute.get('/vault/tree', (c) =>
  c.json(withVault(c, (vault) => ({ folders: vault.listFolders(), notes: vault.listNotes() }))),
);

vaultRoute.get('/vault/note', (c) => {
  const target = c.req.query('path');
  if (!target) throw new ApiError('validation_failed', 'pathを指定してください');
  return c.json(
    withVault(c, (vault) => {
      const note = vault.read(target);
      const backlinks = vault.backlinks(note.title).map((n) => ({ path: n.path, title: n.title }));
      return {
        path: note.path,
        title: note.title,
        description: note.description,
        category: note.category,
        tags: note.tags,
        body: note.body,
        content: note.content,
        version: note.version,
        backlinks,
      };
    }),
  );
});

/** [[タイトル]]のリンク先パスを解決する（無ければnull） */
vaultRoute.get('/vault/resolve', (c) => {
  const title = c.req.query('title');
  if (!title) throw new ApiError('validation_failed', 'titleを指定してください');
  return c.json(withVault(c, (vault) => ({ path: vault.findPathByTitle(title) })));
});

vaultRoute.get('/vault/search', (c) => {
  const q = c.req.query('q') ?? '';
  return c.json(withVault(c, (vault) => ({ notes: vault.search(q, 50) })));
});

const createSchema = z.object({
  path: z.string().min(1),
  description: z.string(),
  category: z.enum(['profile', 'project', 'topic', 'person', 'decision']),
});

vaultRoute.post('/vault/note', async (c) => {
  const body = await parseBody(c, createSchema);
  const note = withVault(c, (vault) =>
    vault.create(body.path, { description: body.description, category: body.category, tags: [], extra: [] }, ''),
  );
  c.get('logger').info({ path: note.path }, 'vault_note_created');
  return c.json({ path: note.path, version: note.version }, 201);
});

const saveSchema = z.object({ path: z.string().min(1), content: z.string(), version: z.string().min(1) });

/** ソース編集の保存。frontmatter込みのファイル全体を置き換える */
vaultRoute.put('/vault/note', async (c) => {
  const body = await parseBody(c, saveSchema);
  const note = withVault(c, (vault) => vault.writeContent(body.path, body.content, body.version));
  return c.json({ path: note.path, version: note.version });
});

const moveSchema = z.object({ path: z.string().min(1), to: z.string().min(1), version: z.string().min(1) });

vaultRoute.post('/vault/move', async (c) => {
  const body = await parseBody(c, moveSchema);
  const { note, rewritten } = withVault(c, (vault) => vault.move(body.path, body.to, body.version));
  c.get('logger').info({ from: body.path, to: note.path, rewritten: rewritten.length }, 'vault_note_moved');
  return c.json({ path: note.path, version: note.version, rewritten });
});

const deleteSchema = z.object({ path: z.string().min(1), version: z.string().min(1) });

vaultRoute.delete('/vault/note', async (c) => {
  const body = await parseBody(c, deleteSchema);
  const dest = withVault(c, (vault) => vault.trash(body.path, body.version));
  c.get('logger').info({ path: body.path, dest }, 'vault_note_trashed');
  return c.json({ trashed_to: dest });
});

/** ![[画像]]の配信。マジックバイトで画像と確認できたものだけ返す（CLAUDE.md 絶対に守ること 9） */
vaultRoute.get('/vault/attachments/:name', (c) => {
  const name = c.req.param('name');
  const abs = withVault(c, (vault) => vault.attachmentPath(name));
  if (!abs) throw new ApiError('not_found', '添付ファイルが見つかりません');
  const buf = fs.readFileSync(abs);
  const mime = detectImageMime(buf);
  if (!mime) throw new ApiError('not_found', '画像として認識できないファイルです');
  c.header('Content-Type', mime);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'private, max-age=300');
  return c.body(new Uint8Array(buf));
});
