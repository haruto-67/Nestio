import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { runMigrations } from '../db/migrate.js';

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function insertTestUser(db: Database.Database, id: string): void {
  db.prepare(
    'INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, `sub-${id}`, `${id}@example.com`, id, Date.now());
}

export function insertTestList(db: Database.Database, userId: string): string {
  const listId = uuidv7();
  db.prepare(
    `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
  ).run(listId, userId, Date.now(), Date.now());
  return listId;
}

export function insertTestTask(db: Database.Database, userId: string, listId: string, title = 'task'): string {
  const taskId = uuidv7();
  db.prepare(
    `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, NULL, ?, '', 0, NULL, NULL, NULL, NULL, 1, ?, ?, NULL, 1)`,
  ).run(taskId, userId, listId, title, Date.now(), Date.now());
  return taskId;
}
