import Database from 'better-sqlite3';
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
