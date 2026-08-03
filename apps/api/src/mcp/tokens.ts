import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { uuidv7 } from '@nestio/shared';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 平文は保存せずハッシュのみ保存する（要件定義3.10・3.14） */
export function issueAccessToken(
  db: Database.Database,
  userId: string,
  clientId: string,
  scope: string,
): { token: string; expiresAt: number } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  db.prepare(
    `INSERT INTO oauth_tokens (id, user_id, client_id, token_hash, scope, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(uuidv7(), userId, clientId, hashToken(token), scope, expiresAt, Date.now());

  return { token, expiresAt };
}

export interface VerifiedToken {
  userId: string;
  scope: string;
}

export function verifyAccessToken(db: Database.Database, token: string): VerifiedToken | null {
  const row = db
    .prepare('SELECT user_id, scope, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = ?')
    .get(hashToken(token)) as
    | { user_id: string; scope: string; expires_at: number; revoked_at: number | null }
    | undefined;

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at < Date.now()) return null;

  return { userId: row.user_id, scope: row.scope };
}

export function hasScope(verified: VerifiedToken, required: 'read' | 'write'): boolean {
  const scopes = verified.scope.split(' ');
  if (required === 'read') return scopes.includes('read') || scopes.includes('write');
  return scopes.includes('write');
}
