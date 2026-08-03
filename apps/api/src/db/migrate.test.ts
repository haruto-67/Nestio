import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

describe('runMigrations', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it('docs/schema.sql 由来のテーブルを作成する', () => {
    db = new Database(':memory:');
    const { applied } = runMigrations(db);

    expect(applied).toContain('0001_init.sql');

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const expected of ['users', 'folders', 'lists', 'tasks', 'tags', 'notes', 'attachments', 'triggers']) {
      expect(tables).toContain(expected);
    }
  });

  it('2回実行しても冪等（同じマイグレーションは再適用しない）', () => {
    db = new Database(':memory:');
    runMigrations(db);
    const second = runMigrations(db);

    expect(second.applied).toEqual([]);
  });
});
