import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { uuidv7 } from '@nestio/shared';

const UPLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;
// 検証には成功したがバイト列検証（sha256照合・マジックバイト等）で失敗した場合に備え、
// 確定消費前の再試行を数回まで許す（改修17回目フォローアップ3）。TTLが5分と短いため、
// この回数を増やしても攻撃面はほとんど広がらない
const MAX_VERIFY_ATTEMPTS = 3;

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
       (id, user_id, owner_type, owner_id, filename, sha256, token_hash, expires_at, used_at, attempt_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`,
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

export type VerifyUploadTokenResult =
  | { ok: true; tokenId: string; token: VerifiedUploadToken }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' | 'attempts_exceeded' };

/**
 * トークンを検証する（改修17回目フォローアップ3：以前はここで即座に使用済みにしていたため、
 * sha256不一致等でバイト列検証に失敗すると、正しいファイルで直後に再試行してもトークンが
 * 既に消費済みでリトライ不能になっていた）。ここでは検証と試行回数の消費だけ行い、
 * 「確定消費」（used_atのセット）はバイト列検証まで全て通過した呼び出し側が
 * markUploadTokenConsumedで別途行う
 */
export function verifyUploadToken(db: Database.Database, token: string): VerifyUploadTokenResult {
  const row = db
    .prepare(
      `SELECT id, user_id, owner_type, owner_id, filename, sha256, expires_at, used_at
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
        used_at: number | null;
      }
    | undefined;

  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at !== null) return { ok: false, reason: 'used' };
  if (row.expires_at < Date.now()) return { ok: false, reason: 'expired' };

  // 試行回数のインクリメントと上限チェックをアトミックに行う（同時リクエストでの競合を避ける）
  const incremented = db
    .prepare('UPDATE attachment_upload_tokens SET attempt_count = attempt_count + 1 WHERE id = ? AND attempt_count < ?')
    .run(row.id, MAX_VERIFY_ATTEMPTS);
  if (incremented.changes === 0) return { ok: false, reason: 'attempts_exceeded' };

  return {
    ok: true,
    tokenId: row.id,
    token: {
      userId: row.user_id,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      filename: row.filename,
      sha256: row.sha256,
    },
  };
}

/** バイト列検証まで全て通過した後に呼び、トークンを確定的に使用済みにする */
export function markUploadTokenConsumed(db: Database.Database, tokenId: string): void {
  db.prepare('UPDATE attachment_upload_tokens SET used_at = ? WHERE id = ?').run(Date.now(), tokenId);
}
