import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { uuidv7 } from '@nestio/shared';

const UPLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface IssuedUploadToken {
  token: string;
  expiresAt: number;
}

/**
 * MCP経由のアップロード用ワンタイムトークンを発行する（改修17回目）。MCPのアクセストークンは
 * Anthropicのインフラで完結しコンテナ内のClaudeには渡らないため、curlでattachmentsRouteを
 * 直接叩くにはこの用途限定トークンが必要になる。特定のsha256（バイト列）にひも付けることで、
 * トークンが漏れても任意ファイルの設置には使えない
 */
export function issueUploadToken(
  db: Database.Database,
  userId: string,
  ownerType: 'task' | 'note',
  ownerId: string,
  filename: string,
  sha256: string,
): IssuedUploadToken {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + UPLOAD_TOKEN_TTL_MS;

  db.prepare(
    `INSERT INTO attachment_upload_tokens
       (id, user_id, owner_type, owner_id, filename, sha256, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(uuidv7(), userId, ownerType, ownerId, filename, sha256, hashToken(token), expiresAt, Date.now());

  return { token, expiresAt };
}

export interface VerifiedUploadToken {
  userId: string;
  ownerType: 'task' | 'note';
  ownerId: string;
  filename: string;
  sha256: string;
}

/**
 * トークンを検証し、成功したその場で使用済みにする（1回使い切り）。
 * `used_at IS NULL`条件付きUPDATEの変更件数で判定することで、同時リクエストによる
 * 二重使用の競合を避ける
 */
export function consumeUploadToken(db: Database.Database, token: string): VerifiedUploadToken | null {
  const row = db
    .prepare(
      `SELECT id, user_id, owner_type, owner_id, filename, sha256, expires_at
       FROM attachment_upload_tokens WHERE token_hash = ?`,
    )
    .get(hashToken(token)) as
    | {
        id: string;
        user_id: string;
        owner_type: 'task' | 'note';
        owner_id: string;
        filename: string;
        sha256: string;
        expires_at: number;
      }
    | undefined;

  if (!row) return null;
  if (row.expires_at < Date.now()) return null;

  const result = db
    .prepare('UPDATE attachment_upload_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(Date.now(), row.id);
  if (result.changes === 0) return null;

  return {
    userId: row.user_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    filename: row.filename,
    sha256: row.sha256,
  };
}
