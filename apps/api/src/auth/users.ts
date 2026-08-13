import type Database from 'better-sqlite3';
import { uuidv7, type UserRow } from '@nestio/shared';
import type { GoogleUserInfo } from './google.js';

/** email_verified の検証は呼び出し側（routes/auth.ts）で行ってから呼ぶこと */
export function findOrCreateUser(db: Database.Database, googleUser: GoogleUserInfo): UserRow {
  const existing = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(googleUser.sub) as
    | UserRow
    | undefined;
  if (existing) return existing;

  const id = uuidv7();
  db.prepare(
    'INSERT INTO users (id, google_sub, email, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, googleUser.sub, googleUser.email, googleUser.name, googleUser.picture ?? null, Date.now());

  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
}

export function findUserById(db: Database.Database, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function findUserByGoogleSub(db: Database.Database, googleSub: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE google_sub = ?').get(googleSub) as UserRow | undefined;
}

export function findUserByEmail(db: Database.Database, email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
}
