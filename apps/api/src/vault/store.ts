import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseNote, serializeNote, type NoteFrontmatter } from './frontmatter.js';
import { parseWikiLinkTargets, rewriteWikiLinks } from './wiki-links.js';
import {
  VaultError,
  normalizeNotePath,
  normalizeRelPath,
  resolveInVault,
  titleFromPath,
  validateTitle,
} from './paths.js';

/**
 * ナレッジVaultのストレージ層（改修25回目、docs/vault-spec.md）。
 * Vaultのmdファイルが唯一の正で、索引・検索・バックリンクは毎回ディスクを読む（ステートレス型）。
 * ファイル操作はすべて同期APIで行うため、1回のメソッド呼び出し内のread-modify-writeは
 * Nodeの単一スレッド上で他リクエストに割り込まれない。
 */

export interface NoteMeta {
  path: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
}

export interface Note extends NoteMeta {
  body: string;
  /** frontmatterを含むファイル全体 */
  content: string;
  version: string;
  frontmatter: NoteFrontmatter;
}

export interface SearchHit extends NoteMeta {
  snippet: string;
}

export const ATTACHMENT_FOLDER = 'attachments';
export const TRASH_FOLDER = '.trash';

export function computeVersion(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

function atomicWrite(abs: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs);
}

function isHiddenOrExcluded(name: string, depth: number): boolean {
  return name.startsWith('.') || (depth === 0 && name === ATTACHMENT_FOLDER);
}

export class VaultStore {
  constructor(readonly root: string) {}

  /** Vault内の全mdの相対パス（posix）。folder指定時はその配下だけ */
  listNotePaths(folder?: string): string[] {
    const base = folder ? normalizeRelPath(folder) : '';
    const startAbs = base ? resolveInVault(this.root, base) : this.root;
    if (!fs.existsSync(startAbs)) return [];

    const out: string[] = [];
    const walk = (abs: string, rel: string, depth: number) => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (isHiddenOrExcluded(entry.name, depth)) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.md')) out.push(childRel);
      }
    };
    walk(startAbs, base, base ? base.split('/').length : 0);
    return out.sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  }

  /** 空フォルダも含めたフォルダ一覧（UIのツリー表示用） */
  listFolders(): string[] {
    if (!fs.existsSync(this.root)) return [];
    const out: string[] = [];
    const walk = (abs: string, rel: string, depth: number) => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (!entry.isDirectory() || isHiddenOrExcluded(entry.name, depth)) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        out.push(childRel);
        walk(path.join(abs, entry.name), childRel, depth + 1);
      }
    };
    walk(this.root, '', 0);
    return out.sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  }

  listNotes(folder?: string): NoteMeta[] {
    return this.listNotePaths(folder).map((p) => {
      const note = this.read(p);
      return { path: note.path, title: note.title, description: note.description, category: note.category, tags: note.tags };
    });
  }

  exists(rel: string): boolean {
    return fs.existsSync(resolveInVault(this.root, normalizeNotePath(rel)));
  }

  read(rel: string): Note {
    const notePath = normalizeNotePath(rel);
    const abs = resolveInVault(this.root, notePath);
    if (!fs.existsSync(abs)) throw new VaultError('not_found', `ナレッジが見つかりません: ${notePath}`);
    return this.toNote(notePath, fs.readFileSync(abs, 'utf8'));
  }

  private toNote(notePath: string, content: string): Note {
    const parsed = parseNote(content);
    return {
      path: notePath,
      title: titleFromPath(notePath),
      description: parsed.frontmatter.description,
      category: parsed.frontmatter.category,
      tags: parsed.frontmatter.tags,
      body: parsed.body,
      content,
      version: computeVersion(content),
      frontmatter: parsed.frontmatter,
    };
  }

  /** タイトル（ファイル名）で探す。Vault全体で一意なので大文字小文字を無視して比較する */
  findPathByTitle(title: string): string | null {
    const key = title.trim().toLowerCase();
    return this.listNotePaths().find((p) => titleFromPath(p).toLowerCase() === key) ?? null;
  }

  /** `/`を含むか`.md`で終わればパス、それ以外はタイトルとして解決する */
  resolve(pathOrTitle: string): string | null {
    if (pathOrTitle.includes('/') || pathOrTitle.endsWith('.md')) {
      const p = normalizeNotePath(pathOrTitle);
      return this.exists(p) ? p : null;
    }
    return this.findPathByTitle(pathOrTitle);
  }

  private assertVersion(current: Note, expectedVersion: string | undefined): void {
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new VaultError(
        'conflict',
        `競合: 「${current.title}」は読み取り後に更新されています（version=${expectedVersion}, 現在=${current.version}）。読み直してから再実行してください`,
      );
    }
  }

  private assertTitleAvailable(notePath: string, ignorePath?: string): void {
    const title = titleFromPath(notePath);
    const invalid = validateTitle(title);
    if (invalid) throw new VaultError('invalid', invalid);
    const existing = this.findPathByTitle(title);
    if (existing && existing !== ignorePath) {
      throw new VaultError('exists', `同名のナレッジが既にあります: ${existing}（ファイル名はVault全体で一意）`);
    }
  }

  /** 新規作成。同名タイトルがVault内にあれば失敗する */
  create(rel: string, frontmatter: NoteFrontmatter, body: string): Note {
    const notePath = normalizeNotePath(rel);
    this.assertTitleAvailable(notePath);
    const content = serializeNote(frontmatter, body);
    atomicWrite(resolveInVault(this.root, notePath), content);
    return this.toNote(notePath, content);
  }

  /** frontmatterと本文を差し替える。expectedVersionを渡すと食い違い時にconflict */
  update(rel: string, change: (current: Note) => { frontmatter: NoteFrontmatter; body: string }, expectedVersion?: string): Note {
    const current = this.read(rel);
    this.assertVersion(current, expectedVersion);
    const next = change(current);
    const content = serializeNote(next.frontmatter, next.body);
    atomicWrite(resolveInVault(this.root, current.path), content);
    return this.toNote(current.path, content);
  }

  /** ファイル全体（frontmatter込みのソース）を書き換える。Web UIのソース編集用 */
  writeContent(rel: string, content: string, expectedVersion?: string): Note {
    const current = this.read(rel);
    this.assertVersion(current, expectedVersion);
    const normalized = content.replace(/\r\n/g, '\n');
    atomicWrite(resolveInVault(this.root, current.path), normalized);
    return this.toNote(current.path, normalized);
  }

  /**
   * 移動・リネーム。タイトルが変わる場合は、Vault内でそのノートを指す[[リンク]]を新タイトルへ書き換える。
   * 戻り値のrewrittenはリンクを書き換えたノートのパス
   */
  move(fromRel: string, toRel: string, expectedVersion?: string): { note: Note; rewritten: string[] } {
    const current = this.read(fromRel);
    this.assertVersion(current, expectedVersion);
    const toPath = normalizeNotePath(toRel);
    if (toPath === current.path) return { note: current, rewritten: [] };
    this.assertTitleAvailable(toPath, current.path);
    const toAbs = resolveInVault(this.root, toPath);
    if (fs.existsSync(toAbs)) throw new VaultError('exists', `移動先に既にファイルがあります: ${toPath}`);

    fs.mkdirSync(path.dirname(toAbs), { recursive: true });
    fs.renameSync(resolveInVault(this.root, current.path), toAbs);

    const oldTitle = current.title;
    const newTitle = titleFromPath(toPath);
    const rewritten: string[] = [];
    if (oldTitle !== newTitle) {
      for (const p of this.listNotePaths()) {
        const abs = resolveInVault(this.root, p);
        const content = fs.readFileSync(abs, 'utf8');
        const next = rewriteWikiLinks(content, oldTitle, newTitle);
        if (next !== content) {
          atomicWrite(abs, next);
          rewritten.push(p);
        }
      }
    }
    return { note: this.read(toPath), rewritten };
  }

  /** 削除は.trash/への移動（Obsidianと同じ）。同名があれば時刻を付ける */
  trash(rel: string, expectedVersion?: string): string {
    const current = this.read(rel);
    this.assertVersion(current, expectedVersion);
    let dest = `${TRASH_FOLDER}/${path.posix.basename(current.path)}`;
    if (fs.existsSync(path.join(this.root, dest))) {
      dest = `${TRASH_FOLDER}/${current.title} ${Date.now()}.md`;
    }
    const destAbs = path.join(this.root, dest);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.renameSync(resolveInVault(this.root, current.path), destAbs);
    return dest;
  }

  /** 空白区切りの全語をタイトル・説明・タグ・本文のいずれかに含むノート。タイトル一致を上位に並べる */
  search(q: string, limit = 20): SearchHit[] {
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    if (terms.length === 0) return [];
    const hits: { hit: SearchHit; score: number }[] = [];
    for (const p of this.listNotePaths()) {
      const note = this.read(p);
      const title = note.title.toLowerCase();
      const meta = `${note.description} ${note.tags.join(' ')}`.toLowerCase();
      const body = note.body.toLowerCase();
      if (!terms.every((t) => title.includes(t) || meta.includes(t) || body.includes(t))) continue;

      const score = terms.reduce((s, t) => s + (title.includes(t) ? 10 : 0) + (meta.includes(t) ? 3 : 0), 0);
      hits.push({
        hit: {
          path: note.path,
          title: note.title,
          description: note.description,
          category: note.category,
          tags: note.tags,
          snippet: makeSnippet(note.body, terms),
        },
        score,
      });
    }
    return hits
      .sort((a, b) => b.score - a.score || a.hit.path.localeCompare(b.hit.path))
      .slice(0, limit)
      .map((h) => h.hit);
  }

  /** titleへ[[リンク]]しているノート */
  backlinks(title: string): NoteMeta[] {
    const key = title.trim().toLowerCase();
    const out: NoteMeta[] = [];
    for (const p of this.listNotePaths()) {
      const note = this.read(p);
      if (note.title.toLowerCase() === key) continue;
      if (parseWikiLinkTargets(note.body).some((t) => t.toLowerCase() === key)) {
        out.push({ path: note.path, title: note.title, description: note.description, category: note.category, tags: note.tags });
      }
    }
    return out;
  }

  /** 画像をattachments/へ保存し、Vault内の相対パスを返す。同名があれば連番を付ける */
  saveAttachment(fileName: string, data: Buffer): string {
    const base = path.posix.basename(fileName.replace(/\\/g, '/'));
    if (base === '' || base.startsWith('.') || validateTitle(base.replace(/\.[^.]+$/, '')) !== null) {
      throw new VaultError('invalid', `不正なファイル名です: ${fileName}`);
    }
    const ext = path.posix.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    let name = base;
    for (let i = 1; fs.existsSync(path.join(this.root, ATTACHMENT_FOLDER, name)); i++) name = `${stem} ${i}${ext}`;
    const rel = `${ATTACHMENT_FOLDER}/${name}`;
    atomicWrite(resolveInVault(this.root, rel), data);
    return rel;
  }

  /** attachments/配下のファイルの絶対パス（無ければnull） */
  attachmentPath(fileName: string): string | null {
    const base = path.posix.basename(fileName.replace(/\\/g, '/'));
    if (base === '' || base.startsWith('.')) return null;
    const abs = resolveInVault(this.root, `${ATTACHMENT_FOLDER}/${base}`);
    return fs.existsSync(abs) ? abs : null;
  }
}

function makeSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  const idx = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (idx === undefined) return body.slice(0, 120).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, idx - 40);
  return `${start > 0 ? '…' : ''}${body.slice(start, idx + 80).replace(/\s+/g, ' ').trim()}…`;
}

/** ユーザーごとのVault（docs/vault-spec.md 1章: <VAULT_DIR>/<user_id>/） */
export function vaultForUser(vaultDir: string, userId: string): VaultStore {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new VaultError('invalid', 'invalid user id');
  return new VaultStore(path.resolve(vaultDir, userId));
}
