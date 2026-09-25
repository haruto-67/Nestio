import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { uuidv7, type ApiKeyRow } from '@nestio/shared';

// 平文はここでのみ一瞬扱い、DBにはハッシュしか保存しない（oauth_tokens/tokens.tsと同じ方針）。
// 接頭辞を付けておくと、誤って別種のトークンと混同したり、ログや設定ファイルに紛れ込んだ時に
// 目視で気付きやすい
const KEY_PREFIX = 'nestio_sk_';

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/** 生キーは発行時のこの戻り値でのみ得られる。以後はハッシュしか保存されないため二度と取得できない */
export function issueApiKey(
  db: Database.Database,
  userId: string,
  name: string,
  scope: string,
): { id: string; key: string } {
  const id = uuidv7();
  const key = KEY_PREFIX + crypto.randomBytes(24).toString('base64url');

  db.prepare(
    `INSERT INTO api_keys (id, user_id, name, key_hash, scope, last_used_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL)`,
  ).run(id, userId, name, hashKey(key), scope, Date.now());

  return { id, key };
}

export interface VerifiedApiKey {
  id: string;
  userId: string;
  scope: string;
}

/** 検証と同時にlast_used_atを更新する（設定画面での「最終使用日時」表示用） */
export function verifyApiKey(db: Database.Database, key: string): VerifiedApiKey | null {
  const hash = hashKey(key);
  const row = db
    .prepare('SELECT id, user_id, scope, revoked_at FROM api_keys WHERE key_hash = ?')
    .get(hash) as { id: string; user_id: string; scope: string; revoked_at: number | null } | undefined;

  if (!row || row.revoked_at !== null) return null;

  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?').run(Date.now(), hash);
  return { id: row.id, userId: row.user_id, scope: row.scope };
}

/** ダッシュボード専用キーのscope（改修26回目）。read/writeを含まないため/public/以下は叩けない */
export const DASHBOARD_SCOPE = 'dashboard';

/** ダッシュボードAPIは専用キーに加え、通常の読み取り/読み書きキーでも呼べる */
export function canReadDashboard(scope: string): boolean {
  return scope.split(' ').includes(DASHBOARD_SCOPE) || hasApiKeyScope(scope, 'read');
}

export function hasApiKeyScope(scope: string, required: 'read' | 'write'): boolean {
  const scopes = scope.split(' ');
  if (required === 'read') return scopes.includes('read') || scopes.includes('write');
  return scopes.includes('write');
}

/** key_hashは含めない（一覧APIで平文と同じくらい機微な値を露出させないため）。
 * calendar_feedsと同じ慣習で、失効済みは一覧から除外する */
export function listApiKeys(db: Database.Database, userId: string): ApiKeyRow[] {
  return db
    .prepare(
      `SELECT id, user_id, name, scope, last_used_at, created_at, revoked_at FROM api_keys
       WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
    )
    .all(userId) as ApiKeyRow[];
}

export function revokeApiKey(db: Database.Database, userId: string, id: string): boolean {
  const result = db
    .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(Date.now(), id, userId);
  return result.changes > 0;
}
