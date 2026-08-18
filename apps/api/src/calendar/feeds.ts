import type Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { uuidv7 } from '@nestio/shared';

export interface CalendarFeedRow {
  id: string;
  user_id: string;
  token: string;
  list_id: string | null;
  name: string;
  created_at: number;
  revoked_at: number | null;
}

export function createCalendarFeed(
  db: Database.Database,
  userId: string,
  listId: string | null,
  name: string,
): { id: string; token: string } {
  const id = uuidv7();
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    'INSERT INTO calendar_feeds (id, user_id, token, list_id, name, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
  ).run(id, userId, token, listId, name, Date.now());
  return { id, token };
}

export function listCalendarFeeds(db: Database.Database, userId: string): CalendarFeedRow[] {
  return db
    .prepare('SELECT * FROM calendar_feeds WHERE user_id = ? AND revoked_at IS NULL')
    .all(userId) as CalendarFeedRow[];
}

export function revokeCalendarFeed(db: Database.Database, userId: string, id: string): boolean {
  const result = db
    .prepare('UPDATE calendar_feeds SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(Date.now(), id, userId);
  return result.changes > 0;
}

export function findActiveFeedByToken(db: Database.Database, token: string): CalendarFeedRow | undefined {
  return db.prepare('SELECT * FROM calendar_feeds WHERE token = ? AND revoked_at IS NULL').get(token) as
    | CalendarFeedRow
    | undefined;
}
