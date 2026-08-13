import type Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import type { GoogleUserInfo } from './google.js';

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccessRequestRow {
  id: string;
  google_sub: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: AccessRequestStatus;
  requested_at: number;
  decided_at: number | null;
}

export function findAccessRequestBySub(db: Database.Database, googleSub: string): AccessRequestRow | undefined {
  return db.prepare('SELECT * FROM access_requests WHERE google_sub = ?').get(googleSub) as
    | AccessRequestRow
    | undefined;
}

export function createAccessRequest(db: Database.Database, googleUser: GoogleUserInfo): AccessRequestRow {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO access_requests (id, google_sub, email, display_name, avatar_url, status, requested_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(id, googleUser.sub, googleUser.email, googleUser.name, googleUser.picture ?? null, Date.now());
  return db.prepare('SELECT * FROM access_requests WHERE id = ?').get(id) as AccessRequestRow;
}

export function listAccessRequests(db: Database.Database, status?: AccessRequestStatus): AccessRequestRow[] {
  if (status) {
    return db
      .prepare('SELECT * FROM access_requests WHERE status = ? ORDER BY requested_at DESC')
      .all(status) as AccessRequestRow[];
  }
  return db.prepare('SELECT * FROM access_requests ORDER BY requested_at DESC').all() as AccessRequestRow[];
}

export function findAccessRequestById(db: Database.Database, id: string): AccessRequestRow | undefined {
  return db.prepare('SELECT * FROM access_requests WHERE id = ?').get(id) as AccessRequestRow | undefined;
}

/** pending以外への遷移は誤操作防止のため許可しない（承認/却下は一度きり） */
export function decideAccessRequest(
  db: Database.Database,
  id: string,
  status: 'approved' | 'rejected',
): AccessRequestRow | undefined {
  const result = db
    .prepare("UPDATE access_requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(status, Date.now(), id);
  if (result.changes === 0) return undefined;
  return findAccessRequestById(db, id);
}
