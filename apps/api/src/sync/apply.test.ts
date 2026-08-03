import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7, type SyncOp } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { applySyncOps } from './apply.js';

function makeListOp(userId: string, listId: string, updatedAt: number): SyncOp {
  return {
    op_id: uuidv7(),
    table: 'lists',
    id: listId,
    op: 'upsert',
    updated_at: updatedAt,
    fields: { name: 'Inbox', sort_order: 1 },
  };
}

function makeTaskOp(
  listId: string,
  taskId: string,
  updatedAt: number,
  fields: Record<string, unknown>,
): SyncOp {
  return {
    op_id: uuidv7(),
    table: 'tasks',
    id: taskId,
    op: 'upsert',
    updated_at: updatedAt,
    fields: { list_id: listId, title: 'task', sort_order: 1, ...fields },
  };
}

describe('applySyncOps', () => {
  let db: Database.Database;
  let userId: string;
  let listId: string;

  function setup() {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    listId = uuidv7();
    const res = applySyncOps(db, userId, [makeListOp(userId, listId, Date.now())]);
    expect(res.rejected).toEqual([]);
  }

  afterEach(() => {
    db?.close();
  });

  it('同じ op_id を2回pushしても行は重複しない（冪等性）', () => {
    setup();
    const taskId = uuidv7();
    const op = makeTaskOp(listId, taskId, Date.now(), { title: '買い物' });

    const first = applySyncOps(db, userId, [op]);
    const second = applySyncOps(db, userId, [op]);

    expect(first.applied).toEqual([op.op_id]);
    expect(second.applied).toEqual([op.op_id]);

    const rows = db.prepare('SELECT * FROM tasks WHERE id = ?').all(taskId);
    expect(rows).toHaveLength(1);
  });

  it('2つのopで別フィールドを更新すると両方残る', () => {
    setup();
    const taskId = uuidv7();
    const base = Date.now();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, base, { title: '元タイトル', priority: 0 })]);

    const opTitle: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: taskId,
      op: 'upsert',
      updated_at: base + 10,
      fields: { title: '新タイトル' },
    };
    const opPriority: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: taskId,
      op: 'upsert',
      updated_at: base + 20,
      fields: { priority: 3 },
    };

    applySyncOps(db, userId, [opTitle, opPriority]);

    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as { title: string; priority: number };
    expect(row.title).toBe('新タイトル');
    expect(row.priority).toBe(3);
  });

  it('同時刻・同フィールドの更新は決定的に収束する', () => {
    setup();
    const taskId = uuidv7();
    const base = Date.now();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, base, { title: '元タイトル' })]);

    const opA: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: taskId,
      op: 'upsert',
      updated_at: base + 100,
      fields: { title: 'デバイスAのタイトル' },
    };
    const opB: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: taskId,
      op: 'upsert',
      updated_at: base + 100,
      fields: { title: 'デバイスBのタイトル' },
    };

    const runOnce = () => {
      const localDb = createTestDb();
      const localUser = uuidv7();
      insertTestUser(localDb, localUser);
      const localList = uuidv7();
      applySyncOps(localDb, localUser, [makeListOp(localUser, localList, base)]);
      applySyncOps(localDb, localUser, [
        makeTaskOp(localList, taskId, base, { title: '元タイトル' }),
      ]);
      applySyncOps(localDb, localUser, [
        { ...opA, id: taskId },
        { ...opB, id: taskId },
      ]);
      const row = localDb.prepare('SELECT title FROM tasks WHERE id = ?').get(taskId) as { title: string };
      localDb.close();
      return row.title;
    };

    const result1 = runOnce();
    const result2 = runOnce();
    expect(result1).toBe(result2);
    expect(result1).toBe('デバイスBのタイトル'); // 後から処理された方が勝つ
  });

  it('parent_id の循環参照は片方がrejectされる', () => {
    setup();
    const taskA = uuidv7();
    const taskB = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskA, Date.now(), { title: 'A' })]);
    applySyncOps(db, userId, [makeTaskOp(listId, taskB, Date.now(), { title: 'B' })]);

    // A を B の子に
    const opAtoB: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: taskA,
      op: 'upsert',
      updated_at: Date.now(),
      fields: { parent_id: taskB },
    };
    const res1 = applySyncOps(db, userId, [opAtoB]);
    expect(res1.rejected).toEqual([]);

    // B を A の子に（循環）
    const opBtoA: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: taskB,
      op: 'upsert',
      updated_at: Date.now(),
      fields: { parent_id: taskA },
    };
    const res2 = applySyncOps(db, userId, [opBtoA]);
    expect(res2.rejected).toEqual([{ op_id: opBtoA.op_id, reason: 'cycle_detected' }]);
  });

  it('未完了の子孫がいる親タスクは完了できない', () => {
    setup();
    const parent = uuidv7();
    const child = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, parent, Date.now(), { title: '親' })]);
    applySyncOps(db, userId, [
      makeTaskOp(listId, child, Date.now(), { title: '子', parent_id: parent }),
    ]);

    const completeParent: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: parent,
      op: 'upsert',
      updated_at: Date.now(),
      fields: { completed_at: Date.now() },
    };
    const res = applySyncOps(db, userId, [completeParent]);

    expect(res.rejected).toEqual([{ op_id: completeParent.op_id, reason: 'parent_incomplete' }]);
  });

  it('完了済み親に未完了の子が同期されてくると親が未完了に戻る', () => {
    setup();
    const parent = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, parent, Date.now(), { title: '親' })]);
    applySyncOps(db, userId, [
      {
        op_id: uuidv7(),
        table: 'tasks',
        id: parent,
        op: 'upsert',
        updated_at: Date.now(),
        fields: { completed_at: Date.now() },
      },
    ]);

    let row = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(parent) as {
      completed_at: number | null;
    };
    expect(row.completed_at).not.toBeNull();

    const child = uuidv7();
    const res = applySyncOps(db, userId, [
      makeTaskOp(listId, child, Date.now(), { title: '子', parent_id: parent }),
    ]);
    expect(res.rejected).toEqual([]);

    row = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(parent) as {
      completed_at: number | null;
    };
    expect(row.completed_at).toBeNull();
  });

  it('他ユーザーの行を書き換えようとするとforbidden', () => {
    setup();
    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: '自分のタスク' })]);

    const otherUser = uuidv7();
    insertTestUser(db, otherUser);

    const op: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: taskId,
      op: 'upsert',
      updated_at: Date.now(),
      fields: { title: '乗っ取り' },
    };
    const res = applySyncOps(db, otherUser, [op]);
    expect(res.rejected).toEqual([{ op_id: op.op_id, reason: 'forbidden' }]);
  });

  it('due_at と due_date を同時に指定するとreject', () => {
    setup();
    const taskId = uuidv7();
    const op = makeTaskOp(listId, taskId, Date.now(), {
      title: 'due両方',
      due_at: Date.now(),
      due_date: '2026-01-01',
    });
    const res = applySyncOps(db, userId, [op]);
    expect(res.rejected).toEqual([{ op_id: op.op_id, reason: 'validation_failed' }]);
  });

  it('存在しない行へのdeleteは無視される（冪等）', () => {
    setup();
    const op: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: uuidv7(),
      op: 'delete',
      updated_at: Date.now(),
      fields: {},
    };
    const res = applySyncOps(db, userId, [op]);
    expect(res.applied).toEqual([op.op_id]);
    expect(res.rejected).toEqual([]);
  });

  it('user_settings は user_id をidとして扱い、無ければ作成、あれば更新する', () => {
    setup();
    const op: SyncOp = {
      op_id: uuidv7(),
      table: 'user_settings',
      id: userId,
      op: 'upsert',
      updated_at: Date.now(),
      fields: { theme: 'dark', keymap_json: '{"quick_add":"n"}' },
    };
    const res = applySyncOps(db, userId, [op]);
    expect(res.rejected).toEqual([]);

    const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as {
      theme: string;
      keymap_json: string;
    };
    expect(row.theme).toBe('dark');
    expect(row.keymap_json).toBe('{"quick_add":"n"}');

    const op2: SyncOp = {
      op_id: uuidv7(),
      table: 'user_settings',
      id: userId,
      op: 'upsert',
      updated_at: Date.now() + 10,
      fields: { theme: 'light' },
    };
    applySyncOps(db, userId, [op2]);
    const row2 = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId) as {
      theme: string;
      keymap_json: string;
    };
    expect(row2.theme).toBe('light');
    expect(row2.keymap_json).toBe('{"quick_add":"n"}');
  });

  it('user_settings を他ユーザーのidで書き換えようとするとforbidden', () => {
    setup();
    const otherUser = uuidv7();
    insertTestUser(db, otherUser);
    const op: SyncOp = {
      op_id: uuidv7(),
      table: 'user_settings',
      id: otherUser,
      op: 'upsert',
      updated_at: Date.now(),
      fields: { theme: 'dark' },
    };
    const res = applySyncOps(db, userId, [op]);
    expect(res.rejected).toEqual([{ op_id: op.op_id, reason: 'forbidden' }]);
  });
});

function insertTrigger(
  db: Database.Database,
  userId: string,
  event: string,
  conditionJson = '{}',
  actionKey = 'push_notify',
): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO triggers (id, user_id, name, event, condition_json, action_key, params_json, enabled, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, 'test trigger', ?, ?, ?, '{}', 1, ?, ?, NULL, 1)`,
  ).run(id, userId, event, conditionJson, actionKey, Date.now(), Date.now());
  return id;
}

function queuedRunsFor(db: Database.Database, triggerId: string): { subject_id: string | null }[] {
  return db
    .prepare("SELECT subject_id FROM trigger_runs WHERE trigger_id = ? AND status = 'queued'")
    .all(triggerId) as { subject_id: string | null }[];
}

describe('Hatch event detection (apply.ts統合)', () => {
  let db: Database.Database;
  let userId: string;
  let listId: string;

  function setup() {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    listId = uuidv7();
    applySyncOps(db, userId, [makeListOp(userId, listId, Date.now())]);
  }

  afterEach(() => db?.close());

  it('タスク作成でtask_createdトリガーが積まれる', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'task_created');

    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: '新規タスク' })]);

    const runs = queuedRunsFor(db, triggerId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.subject_id).toBe(taskId);
  });

  it('タスク完了でtask_completedトリガーが積まれる（作成時には積まれない）', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'task_completed');

    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: 'タスク' })]);
    expect(queuedRunsFor(db, triggerId)).toHaveLength(0);

    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: taskId, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
    ]);
    expect(queuedRunsFor(db, triggerId)).toHaveLength(1);
  });

  it('condition_jsonのlist_idが一致しないと発火しない', () => {
    setup();
    const otherListId = uuidv7();
    const triggerId = insertTrigger(db, userId, 'task_created', JSON.stringify({ list_id: otherListId }));

    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: 'タスク' })]);

    expect(queuedRunsFor(db, triggerId)).toHaveLength(0);
  });

  it('condition_jsonのlist_idが一致すれば発火する', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'task_created', JSON.stringify({ list_id: listId }));

    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: 'タスク' })]);

    expect(queuedRunsFor(db, triggerId)).toHaveLength(1);
  });

  it('リスト内の全タスクが完了するとlist_all_completedトリガーが積まれる', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'list_all_completed');

    const task1 = uuidv7();
    const task2 = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, task1, Date.now(), { title: 'タスク1' })]);
    applySyncOps(db, userId, [makeTaskOp(listId, task2, Date.now(), { title: 'タスク2' })]);

    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: task1, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
    ]);
    expect(queuedRunsFor(db, triggerId)).toHaveLength(0); // まだtask2が残っている

    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: task2, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
    ]);
    expect(queuedRunsFor(db, triggerId)).toHaveLength(1);
  });

  it('ループ防止：triggeredByHatchな書き込みからは再発火しない', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'task_created');

    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: 'Hatch起因のタスク' })], {
      triggeredByHatch: true,
    });

    expect(queuedRunsFor(db, triggerId)).toHaveLength(0);
  });

  it('無効化(enabled=0)されたトリガーは発火しない', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'task_created');
    db.prepare('UPDATE triggers SET enabled = 0 WHERE id = ?').run(triggerId);

    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: 'タスク' })]);

    expect(queuedRunsFor(db, triggerId)).toHaveLength(0);
  });
});
