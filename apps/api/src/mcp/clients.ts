import type Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';

export interface OauthClientRow {
  id: string;
  user_id: string;
  name: string;
  redirect_uris: string;
  created_at: number;
}

/** Nestioは1ユーザー専用アプリのため、登録時点でDB内のユーザーへ自動的に紐付ける（docs/open-questions.md 11章） */
function findSoleUserId(db: Database.Database): string | null {
  const row = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function registerOauthClient(
  db: Database.Database,
  name: string,
  redirectUris: string[],
): { client_id: string } | null {
  const userId = findSoleUserId(db);
  if (!userId) return null;

  const id = uuidv7();
  db.prepare(
    'INSERT INTO oauth_clients (id, user_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, userId, name, JSON.stringify(redirectUris), Date.now());
  return { client_id: id };
}

export function findOauthClient(db: Database.Database, clientId: string): OauthClientRow | undefined {
  return db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(clientId) as OauthClientRow | undefined;
}
