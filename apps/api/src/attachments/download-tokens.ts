import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { uuidv7 } from '@nestio/shared';

const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface IssuedDownloadToken {
  token: string;
  expiresAt: number;
}

/**
 * MCP経由の読み出し用ワンタイムトークンを発行する（改修19回目）。書き込み側の
 * upload_attachment（data_base64）と同じ理由で、get_attachmentがbase64をJSON-RPCレスポンスに
 * 乗せる方式には1MB程度の実用上限があり、それを超える添付をcurlで直接GETするために使う
 */
export function issueDownloadToken(db: Database.Database, userId: string, sha256: string): IssuedDownloadToken {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + DOWNLOAD_TOKEN_TTL_MS;

  db.prepare(
    `INSERT INTO attachment_download_tokens (id, user_id, sha256, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).run(uuidv7(), userId, sha256, hashToken(token), expiresAt, Date.now());

  return { token, expiresAt };
}

export interface VerifiedDownloadToken {
  userId: string;
  sha256: string;
}

export type VerifyDownloadTokenResult =
  | { ok: true; tokenId: string; token: VerifiedDownloadToken }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' };

/**
 * トークンを検証し、成功したその場で使用済みにする（1回使い切り）。書き込み用と異なり
 * 読み出しには副作用が無いため、失敗時の再試行を許す必要が無く消費タイミングを分ける
 * 理由も無い
 */
export function verifyDownloadToken(db: Database.Database, token: string): VerifyDownloadTokenResult {
  const row = db
    .prepare('SELECT id, user_id, sha256, expires_at, used_at FROM attachment_download_tokens WHERE token_hash = ?')
    .get(hashToken(token)) as
    | { id: string; user_id: string; sha256: string; expires_at: number; used_at: number | null }
    | undefined;

  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at !== null) return { ok: false, reason: 'used' };
  if (row.expires_at < Date.now()) return { ok: false, reason: 'expired' };

  const result = db
    .prepare('UPDATE attachment_download_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(Date.now(), row.id);
  if (result.changes === 0) return { ok: false, reason: 'used' };

  return { ok: true, tokenId: row.id, token: { userId: row.user_id, sha256: row.sha256 } };
}
