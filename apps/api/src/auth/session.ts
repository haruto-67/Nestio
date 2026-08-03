import type { Context } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type Database from 'better-sqlite3';
import { randomToken } from './pkce.js';

const SESSION_COOKIE = 'nestio_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionRow {
  id: string;
  user_id: string;
  device_id: string | null;
  expires_at: number;
  created_at: number;
}

export function createSession(
  db: Database.Database,
  userId: string,
  deviceId: string | null,
): { sessionId: string; expiresAt: number } {
  const sessionId = randomToken(32);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionId, userId, deviceId, expiresAt, Date.now());
  return { sessionId, expiresAt };
}

/** httpOnly / SameSite=Strict Cookie。本番のみSecureを付与する（開発のhttp://localhostで送信不能になるのを避ける） */
export function setSessionCookie(c: Context, sessionId: string, isProduction: boolean): void {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export function getSessionIdFromRequest(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function findValidSession(db: Database.Database, sessionId: string): SessionRow | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (!row) return undefined;
  if (row.expires_at < Date.now()) return undefined;
  return row;
}

export function destroySession(db: Database.Database, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}
