import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import { rescheduleDueReminder, schedulePomodoroPush, cancelScheduledPush } from './scheduler.js';

describe('rescheduleDueReminder', () => {
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

  it('時刻ありの期限に対して30分前のリマインダーを予約する', () => {
    setup();
    const taskId = insertTestTask(db, userId, listId);
    const dueAt = Date.now() + 60 * 60 * 1000; // 1時間後

    rescheduleDueReminder(db, userId, taskId, 'テストタスク', dueAt, null, null);

    const rows = db
      .prepare("SELECT * FROM scheduled_pushes WHERE task_id = ? AND kind = 'due_reminder'")
      .all(taskId) as { fire_at: number; sent_at: number | null; canceled_at: number | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fire_at).toBe(dueAt - 30 * 60 * 1000);
    expect(rows[0]?.canceled_at).toBeNull();
  });

  it('期限変更時は既存の未送信予約をキャンセルして入れ直す', () => {
    setup();
    const taskId = insertTestTask(db, userId, listId);
    const firstDueAt = Date.now() + 60 * 60 * 1000;
    rescheduleDueReminder(db, userId, taskId, 'テストタスク', firstDueAt, null, null);

    const secondDueAt = Date.now() + 2 * 60 * 60 * 1000;
    rescheduleDueReminder(db, userId, taskId, 'テストタスク', secondDueAt, null, null);

    const rows = db
      .prepare("SELECT * FROM scheduled_pushes WHERE task_id = ? AND kind = 'due_reminder'")
      .all(taskId) as { fire_at: number; canceled_at: number | null }[];
    expect(rows).toHaveLength(2);
    const active = rows.filter((r) => r.canceled_at === null);
    expect(active).toHaveLength(1);
    expect(active[0]?.fire_at).toBe(secondDueAt - 30 * 60 * 1000);
  });

  it('完了済みタスクには新規予約しない', () => {
    setup();
    const taskId = uuidv7();
    rescheduleDueReminder(db, userId, taskId, 'テストタスク', Date.now() + 60 * 60 * 1000, null, Date.now());

    const rows = db.prepare("SELECT * FROM scheduled_pushes WHERE task_id = ? AND kind = 'due_reminder'").all(taskId);
    expect(rows).toHaveLength(0);
  });

  it('期限なしには予約しない', () => {
    setup();
    const taskId = uuidv7();
    rescheduleDueReminder(db, userId, taskId, 'テストタスク', null, null, null);

    const rows = db.prepare("SELECT * FROM scheduled_pushes WHERE task_id = ? AND kind = 'due_reminder'").all(taskId);
    expect(rows).toHaveLength(0);
  });

  it('過去の期限には予約しない', () => {
    setup();
    const taskId = uuidv7();
    rescheduleDueReminder(db, userId, taskId, 'テストタスク', Date.now() - 60 * 60 * 1000, null, null);

    const rows = db.prepare("SELECT * FROM scheduled_pushes WHERE task_id = ? AND kind = 'due_reminder'").all(taskId);
    expect(rows).toHaveLength(0);
  });
});

describe('pomodoro schedule', () => {
  let db: Database.Database;
  let userId: string;

  afterEach(() => db?.close());

  it('指定秒数後に予約し、キャンセルできる', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);

    const before = Date.now();
    const id = schedulePomodoroPush(db, userId, 1500, null);
    const row = db.prepare('SELECT * FROM scheduled_pushes WHERE id = ?').get(id) as {
      fire_at: number;
      kind: string;
    };
    expect(row.kind).toBe('pomodoro');
    expect(row.fire_at).toBeGreaterThanOrEqual(before + 1500 * 1000);

    const canceled = cancelScheduledPush(db, userId, id);
    expect(canceled).toBe(true);

    const canceledAgain = cancelScheduledPush(db, userId, id);
    expect(canceledAgain).toBe(false);
  });

  it('他ユーザーの予約はキャンセルできない', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    const otherUser = uuidv7();
    insertTestUser(db, otherUser);

    const id = schedulePomodoroPush(db, userId, 1500, null);
    expect(cancelScheduledPush(db, otherUser, id)).toBe(false);
  });
});
