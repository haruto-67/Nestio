import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../../test-utils/db.js';
import { runAddTag, runSetPriority, runMoveToList, runCreateTask, runCreateNote } from './internal.js';

describe('hatch internal actions', () => {
  let db: Database.Database;
  let userId: string;
  let listId: string;

  afterEach(() => db?.close());

  function setup() {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    listId = insertTestList(db, userId);
  }

  it('runAddTag: タグを付与する', () => {
    setup();
    const taskId = insertTestTask(db, userId, listId);
    const tagId = uuidv7();
    db.prepare(
      "INSERT INTO tags (id, user_id, name, color, created_at, updated_at, deleted_at, seq) VALUES (?, ?, 'urgent', '#f00', ?, ?, NULL, 1)",
    ).run(tagId, userId, Date.now(), Date.now());

    runAddTag(db, userId, taskId, { tag_id: tagId });

    const row = db.prepare('SELECT * FROM task_tags WHERE task_id = ? AND tag_id = ?').get(taskId, tagId);
    expect(row).toBeDefined();
  });

  it('runSetPriority: 優先度を変更する', () => {
    setup();
    const taskId = insertTestTask(db, userId, listId);
    runSetPriority(db, userId, taskId, { priority: 3 });

    const row = db.prepare('SELECT priority FROM tasks WHERE id = ?').get(taskId) as { priority: number };
    expect(row.priority).toBe(3);
  });

  it('runMoveToList: リストを移動する', () => {
    setup();
    const taskId = insertTestTask(db, userId, listId);
    const otherListId = insertTestList(db, userId);
    runMoveToList(db, userId, taskId, { list_id: otherListId });

    const row = db.prepare('SELECT list_id FROM tasks WHERE id = ?').get(taskId) as { list_id: string };
    expect(row.list_id).toBe(otherListId);
  });

  it('runCreateTask: テンプレートを展開してタスクを作成する', async () => {
    setup();
    const subjectTaskId = insertTestTask(db, userId, listId, '元タスク');
    const newId = await runCreateTask(db, userId, subjectTaskId, {
      list_id: listId,
      title_template: '{{task.title}}のフォローアップ',
    });

    const row = db.prepare('SELECT title FROM tasks WHERE id = ?').get(newId) as { title: string };
    expect(row.title).toBe('元タスクのフォローアップ');
  });

  it('runCreateTask: due_offset_daysを指定すると終日期限が設定される', async () => {
    setup();
    const newId = await runCreateTask(db, userId, null, {
      list_id: listId,
      title_template: '明日のタスク',
      due_offset_days: 1,
    });
    const row = db.prepare('SELECT due_date FROM tasks WHERE id = ?').get(newId) as { due_date: string | null };
    expect(row.due_date).not.toBeNull();
  });

  it('runCreateNote: テンプレートを展開してメモを作成する', async () => {
    setup();
    const subjectTaskId = insertTestTask(db, userId, listId, '対象タスク');
    const noteId = await runCreateNote(db, userId, subjectTaskId, {
      title_template: '{{task.title}}の記録',
      body_template: '完了: {{task.title}}',
    });

    const row = db.prepare('SELECT title, body FROM notes WHERE id = ?').get(noteId) as {
      title: string;
      body: string;
    };
    expect(row.title).toBe('対象タスクの記録');
    expect(row.body).toBe('完了: 対象タスク');
  });
});
