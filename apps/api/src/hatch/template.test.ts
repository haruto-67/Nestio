import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import { expandTemplate } from './template.js';

describe('expandTemplate', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('task.title / list.nameを展開する', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = insertTestTask(db, userId, listId, 'テストタスク');

    const result = expandTemplate(db, '{{task.title}} in {{list.name}}', taskId);

    expect(result).toBe('テストタスク in Inbox');
  });

  it('taskIdがnullなら全プレースホルダを空文字にする', () => {
    db = createTestDb();
    const result = expandTemplate(db, 'hello {{task.title}} world', null);
    expect(result).toBe('hello  world');
  });

  it('存在しないtaskIdでもエラーにならず空文字になる', () => {
    db = createTestDb();
    const result = expandTemplate(db, '{{task.title}}', uuidv7());
    expect(result).toBe('');
  });

  it('due_dateがある場合はdue_atより優先される', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = uuidv7();
    db.prepare(
      `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, ?, NULL, 't', '', 0, NULL, '2026-01-01', NULL, NULL, 1, ?, ?, NULL, 1)`,
    ).run(taskId, userId, listId, Date.now(), Date.now());

    const result = expandTemplate(db, '{{task.due}}', taskId);

    expect(result).toBe('2026-01-01');
  });

  it('未知のプレースホルダは空文字になる', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = insertTestTask(db, userId, listId, 't');

    const result = expandTemplate(db, '{{unknown.key}}', taskId);

    expect(result).toBe('');
  });
});
