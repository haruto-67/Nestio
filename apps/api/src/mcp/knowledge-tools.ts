import type Database from 'better-sqlite3';
import path from 'node:path';
import { knowledgeCategorySchema, sha256Schema } from '@nestio/shared';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { detectImageMime, verifyImageIntegrity } from '../attachments/magic-bytes.js';
import { attachmentExists, readAttachmentFile, userOwnsAttachment } from '../attachments/storage.js';
import { vaultForUser, type Note, type NoteMeta, type VaultStore } from '../vault/store.js';
import { VaultError, normalizeRelPath } from '../vault/paths.js';
import { appendToSection, getOutline, getSection } from '../vault/outline.js';
import type { NoteFrontmatter } from '../vault/frontmatter.js';

/**
 * ナレッジ用MCPツール（改修25回目：DBからObsidian形式のVaultへ載せ替え。docs/vault-spec.md）。
 * ツール名は旧DB版と同じものを維持し、引数・戻り値をVault基準（パス・version）に変えた。
 */

export class KnowledgeToolError extends Error {}

interface ToolDefLike {
  name: string;
  scope: 'read' | 'write';
  description: string;
  inputSchema: Record<string, unknown>;
}

const CATEGORY_DESC = "'profile' | 'project' | 'topic' | 'person' | 'decision'";
const TARGET_DESC = 'Vault内のパス（例: projects/Nestio/Nestio.md）またはタイトル（ファイル名。Vault全体で一意）';
const INLINE_ATTACHMENT_MAX_BYTES = 8 * 1024;

export const KNOWLEDGE_TOOL_DEFS: ToolDefLike[] = [
  {
    name: 'get_knowledge_index',
    scope: 'read',
    description:
      'ナレッジVaultの索引をフォルダごとに返す（各ノートのtitle / description / category / tags。本文は含まない）。' +
      'folderを指定するとそのサブツリーだけ返す。何があるか把握してから、必要なものだけget_knowledgeで本文を取りに行く',
    inputSchema: {
      type: 'object',
      properties: { folder: { type: 'string', description: '例: projects/Nestio（省略時はVault全体）' } },
    },
  },
  {
    name: 'get_knowledge',
    scope: 'read',
    description:
      'ナレッジの本文（Markdown）を取得する。paths/titlesどちらも複数指定可（往復削減のため配列で渡せる）。' +
      'headingを指定するとその見出しのセクションだけ返す（見出し一覧はget_knowledge_outline）。' +
      'frontmatter_only: trueで本文を省きfrontmatterだけ返す。戻り値のversionを更新時のexpected_versionに使う',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'Vault内のパスの配列' },
        titles: { type: 'array', items: { type: 'string' }, description: 'タイトルの配列' },
        heading: { type: 'string', description: '見出しのテキスト（#は付けない）。1件指定時のみ有効' },
        frontmatter_only: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_knowledge_outline',
    scope: 'read',
    description: 'ナレッジの見出し一覧（レベルとテキスト）を返す。1ノート全体を読まずに必要なセクションだけ読むために使う',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', description: TARGET_DESC } },
      required: ['target'],
    },
  },
  {
    name: 'upsert_knowledge',
    scope: 'write',
    description:
      'ナレッジを作成または更新する。titleまたはpathで対象を指定し、無ければ新規作成する。' +
      '新規作成時はdescription（1行要約）とcategoryが必須。置き場所はpathで指定する（profile/topicは省略するとprofile/・topics/に置く。' +
      'project/decision/personはprojects/<プロジェクト名>/配下のpath必須）。本文はMarkdownのまま保存する。' +
      'append: trueで末尾に追記（headingも指定するとその見出しのセクション末尾に追記）。' +
      '既存ノートを更新する時はget_knowledgeで得たversionをexpected_versionに渡すこと（他セッションやObsidianでの変更を無言で上書きしないため。食い違うとエラー）',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'タイトル（=ファイル名）' },
        path: { type: 'string', description: 'Vault内のパス。末尾が/ならそのフォルダにtitle.mdとして作る' },
        description: { type: 'string' },
        category: { type: 'string', description: CATEGORY_DESC },
        tags: { type: 'array', items: { type: 'string' }, description: '指定すると置き換える' },
        body: { type: 'string', description: 'Markdown本文' },
        append: { type: 'boolean', description: 'trueならbodyを既存本文の末尾（またはheadingのセクション末尾）に追記する' },
        heading: { type: 'string', description: 'append時の追記先の見出しテキスト' },
        expected_version: { type: 'string', description: 'get_knowledgeで読んだ時点のversion' },
      },
    },
  },
  {
    name: 'move_knowledge',
    scope: 'write',
    description:
      'ナレッジを移動・リネームする。タイトルが変わる場合、Vault内でそのノートを指す[[リンク]]を新しいタイトルへ書き換える',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: TARGET_DESC },
        to: { type: 'string', description: '移動先のパス（例: projects/Nestio/新しい名前.md）' },
        expected_version: { type: 'string' },
      },
      required: ['target', 'to'],
    },
  },
  {
    name: 'delete_knowledge',
    scope: 'write',
    description: 'ナレッジを削除する（Vaultの.trash/へ移動。Obsidianと同じ挙動）',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', description: TARGET_DESC }, expected_version: { type: 'string' } },
      required: ['target'],
    },
  },
  {
    name: 'search_knowledge',
    scope: 'read',
    description: 'ナレッジをタイトル・説明・タグ・本文で検索する（空白区切りの全語を含むもの）。スニペット付きで返す',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, limit: { type: 'number' } },
      required: ['q'],
    },
  },
  {
    name: 'get_backlinks',
    scope: 'read',
    description: '指定ナレッジ（[[タイトル]]でリンクされている側）へのリンク元一覧を返す',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string', description: TARGET_DESC } },
      required: ['target'],
    },
  },
  {
    name: 'add_knowledge_attachment',
    scope: 'write',
    description:
      '画像をVaultのattachments/に保存し、本文に貼るための ![[ファイル名]] を返す。' +
      `data_base64（${INLINE_ATTACHMENT_MAX_BYTES}バイトまで）か、create_attachment_upload等で既にアップロード済みの添付のsha256のどちらかを指定する`,
    inputSchema: {
      type: 'object',
      properties: {
        file_name: { type: 'string', description: '例: 構成図.png' },
        data_base64: { type: 'string' },
        sha256: { type: 'string', description: 'アップロード済みNestio添付のsha256' },
      },
      required: ['file_name'],
    },
  },
];

const KNOWLEDGE_TOOL_NAMES = new Set(KNOWLEDGE_TOOL_DEFS.map((d) => d.name));

export function isKnowledgeTool(name: string): boolean {
  return KNOWLEDGE_TOOL_NAMES.has(name);
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function requireStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key);
  if (v === undefined) throw new KnowledgeToolError(`${key} is required`);
  return v;
}

function strArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key];
  if (!Array.isArray(v)) return undefined;
  return v.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim());
}

function resolveTarget(vault: VaultStore, target: string): string {
  const p = vault.resolve(target);
  if (!p) throw new KnowledgeToolError(`ナレッジが見つかりません: ${target}`);
  return p;
}

/** 索引の1件。トークン節約のため空のtagsは省く */
function indexEntry(n: NoteMeta): Record<string, unknown> {
  const e: Record<string, unknown> = { title: n.title, description: n.description, category: n.category };
  if (n.tags.length > 0) e.tags = n.tags;
  return e;
}

function noteResult(n: Note, opts: { body?: string | null } = {}): Record<string, unknown> {
  const r: Record<string, unknown> = {
    path: n.path,
    title: n.title,
    description: n.description,
    category: n.category,
    tags: n.tags,
    version: n.version,
  };
  if (opts.body !== null) r.body = opts.body ?? n.body;
  return r;
}

function defaultFolder(category: string): string {
  if (category === 'profile') return 'profile';
  if (category === 'topic') return 'topics';
  throw new KnowledgeToolError(
    `category '${category}' の新規作成にはpath（例: projects/<プロジェクト名>/<タイトル>.md）が必要です`,
  );
}

function joinBody(existing: string, addition: string): string {
  const base = existing.replace(/\s+$/, '');
  return base === '' ? `${addition.replace(/\s+$/, '')}\n` : `${base}\n\n${addition.replace(/\s+$/, '')}\n`;
}

export function callKnowledgeTool(
  db: Database.Database,
  env: Env,
  logger: Logger,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): unknown {
  const vault = vaultForUser(env.VAULT_DIR, userId);
  try {
    return dispatch(db, env, logger, userId, vault, name, args);
  } catch (e) {
    if (e instanceof VaultError) throw new KnowledgeToolError(e.message);
    throw e;
  }
}

function dispatch(
  db: Database.Database,
  env: Env,
  logger: Logger,
  userId: string,
  vault: VaultStore,
  name: string,
  args: Record<string, unknown>,
): unknown {
  switch (name) {
    case 'get_knowledge_index': {
      const folder = str(args, 'folder');
      const tree: Record<string, Record<string, unknown>[]> = {};
      for (const n of vault.listNotes(folder)) {
        const dir = path.posix.dirname(n.path);
        (tree[dir === '.' ? '/' : dir] ??= []).push(indexEntry(n));
      }
      return { tree };
    }

    case 'get_knowledge': {
      const paths = strArray(args, 'paths') ?? [];
      const titles = strArray(args, 'titles') ?? [];
      if (paths.length === 0 && titles.length === 0) {
        throw new KnowledgeToolError('pathsまたはtitlesのいずれかを指定してください');
      }
      const heading = str(args, 'heading');
      const frontmatterOnly = args.frontmatter_only === true;
      const targets = [...paths, ...titles];
      if (heading && targets.length !== 1) throw new KnowledgeToolError('headingは1件だけ指定した時に使えます');

      const knowledge: Record<string, unknown>[] = [];
      const notFound: string[] = [];
      const seen = new Set<string>();
      for (const t of targets) {
        const p = vault.resolve(t);
        if (!p) {
          notFound.push(t);
          continue;
        }
        if (seen.has(p)) continue;
        seen.add(p);
        const note = vault.read(p);
        if (frontmatterOnly) {
          knowledge.push(noteResult(note, { body: null }));
        } else if (heading) {
          const section = getSection(note.body, heading);
          if (section === null) throw new KnowledgeToolError(`見出しが見つかりません: ${heading}`);
          knowledge.push(noteResult(note, { body: section }));
        } else {
          knowledge.push(noteResult(note));
        }
      }
      return notFound.length > 0 ? { knowledge, not_found: notFound } : { knowledge };
    }

    case 'get_knowledge_outline': {
      const note = vault.read(resolveTarget(vault, requireStr(args, 'target')));
      return {
        path: note.path,
        title: note.title,
        version: note.version,
        headings: getOutline(note.body).map((h) => ({ level: h.level, text: h.text })),
      };
    }

    case 'upsert_knowledge': {
      const title = str(args, 'title');
      const pathArg = str(args, 'path');
      if (!title && !pathArg) throw new KnowledgeToolError('titleまたはpathを指定してください');

      const description = typeof args.description === 'string' ? args.description : undefined;
      const category = str(args, 'category');
      if (category !== undefined && !knowledgeCategorySchema.safeParse(category).success) {
        throw new KnowledgeToolError(`categoryは${CATEGORY_DESC}のいずれかである必要があります`);
      }
      const tags = strArray(args, 'tags');
      const body = typeof args.body === 'string' ? args.body : undefined;
      const append = args.append === true;
      const heading = str(args, 'heading');
      const expectedVersion = str(args, 'expected_version');

      // 既存ノートの特定: pathが実在すればそれ、無ければtitleで探す
      let existingPath: string | null = null;
      if (pathArg && !pathArg.endsWith('/')) existingPath = vault.resolve(pathArg);
      if (!existingPath && title) existingPath = vault.findPathByTitle(title);

      if (existingPath) {
        if (heading && !append) throw new KnowledgeToolError('headingはappend: trueと組み合わせて使います');
        const note = vault.update(
          existingPath,
          (current) => {
            const fm: NoteFrontmatter = {
              ...current.frontmatter,
              description: description ?? current.frontmatter.description,
              category: category ?? current.frontmatter.category,
              tags: tags ?? current.frontmatter.tags,
            };
            let nextBody = current.body;
            if (body !== undefined) {
              if (append && heading) {
                const appended = appendToSection(current.body, heading, body);
                if (appended === null) throw new KnowledgeToolError(`見出しが見つかりません: ${heading}`);
                nextBody = appended;
              } else if (append) {
                nextBody = joinBody(current.body, body);
              } else {
                nextBody = body.endsWith('\n') ? body : `${body}\n`;
              }
            }
            return { frontmatter: fm, body: nextBody };
          },
          expectedVersion,
        );
        return { path: note.path, title: note.title, version: note.version, created: false };
      }

      if (expectedVersion) throw new KnowledgeToolError('expected_versionが指定されましたが、ナレッジが存在しません');
      if (!description) throw new KnowledgeToolError('新規作成時はdescription（1行要約）が必須です');
      if (!category) throw new KnowledgeToolError('新規作成時はcategoryが必須です');

      let notePath: string;
      if (pathArg && !pathArg.endsWith('/')) {
        notePath = pathArg;
      } else {
        if (!title) throw new KnowledgeToolError('pathがフォルダ指定の時はtitleが必要です');
        const folder = pathArg ? normalizeRelPath(pathArg) : defaultFolder(category);
        notePath = `${folder}/${title}.md`;
      }
      if (title && path.posix.basename(notePath).replace(/\.md$/, '') !== title) {
        throw new KnowledgeToolError('titleとpathのファイル名が一致しません（ファイル名＝タイトル）');
      }
      const note = vault.create(
        notePath,
        { description, category, tags: tags ?? [], extra: [] },
        body === undefined ? '' : body.endsWith('\n') ? body : `${body}\n`,
      );
      logger.info({ path: note.path }, 'vault_note_created');
      return { path: note.path, title: note.title, version: note.version, created: true };
    }

    case 'move_knowledge': {
      const from = resolveTarget(vault, requireStr(args, 'target'));
      const { note, rewritten } = vault.move(from, requireStr(args, 'to'), str(args, 'expected_version'));
      logger.info({ from, to: note.path, rewritten: rewritten.length }, 'vault_note_moved');
      return { path: note.path, title: note.title, version: note.version, rewritten_links_in: rewritten };
    }

    case 'delete_knowledge': {
      const p = resolveTarget(vault, requireStr(args, 'target'));
      const dest = vault.trash(p, str(args, 'expected_version'));
      logger.info({ path: p, dest }, 'vault_note_trashed');
      return { path: p, trashed_to: dest };
    }

    case 'search_knowledge': {
      const q = requireStr(args, 'q');
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      return { knowledge: vault.search(q, limit) };
    }

    case 'get_backlinks': {
      const note = vault.read(resolveTarget(vault, requireStr(args, 'target')));
      return { backlinks: vault.backlinks(note.title).map((n) => ({ path: n.path, title: n.title })) };
    }

    case 'add_knowledge_attachment': {
      const fileName = requireStr(args, 'file_name');
      const dataBase64 = str(args, 'data_base64');
      const sha256 = str(args, 'sha256');
      if (!dataBase64 === !sha256) throw new KnowledgeToolError('data_base64とsha256のどちらか一方を指定してください');

      let buf: Buffer;
      if (dataBase64) {
        buf = Buffer.from(dataBase64, 'base64');
        if (buf.length === 0) throw new KnowledgeToolError('画像データが空です');
        if (buf.length > INLINE_ATTACHMENT_MAX_BYTES) {
          throw new KnowledgeToolError(
            `data_base64は${INLINE_ATTACHMENT_MAX_BYTES}バイトまでです。create_attachment_uploadでアップロードしてからsha256を指定してください`,
          );
        }
      } else {
        if (!sha256Schema.safeParse(sha256).success) throw new KnowledgeToolError('sha256は16進数64桁（小文字）です');
        if (!userOwnsAttachment(db, userId, sha256!) || !attachmentExists(env.ATTACHMENT_DIR, sha256!)) {
          throw new KnowledgeToolError('添付ファイルが見つかりません');
        }
        buf = readAttachmentFile(env.ATTACHMENT_DIR, sha256!, env.ATTACHMENT_ENCRYPTION_KEY || undefined);
      }

      const mime = detectImageMime(buf);
      if (!mime || !verifyImageIntegrity(buf, mime)) {
        throw new KnowledgeToolError('画像形式として認識できないか、データが壊れています（PNG/JPEG/WebP/GIFのみ対応）');
      }
      const rel = vault.saveAttachment(fileName, buf);
      const savedName = path.posix.basename(rel);
      logger.info({ rel, mime, bytes: buf.length }, 'vault_attachment_saved');
      return { path: rel, embed: `![[${savedName}]]` };
    }

    default:
      throw new KnowledgeToolError(`unknown knowledge tool: ${name}`);
  }
}
