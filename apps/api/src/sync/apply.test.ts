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

  // 改修4回目「完了チェックボックスをつけたら別のタスクの完了が外れることがある」の調査用回帰テスト。
  // 親子関係にない無関係なタスクの完了状態が、他タスクの完了/未完了操作で書き換わらないことを保証する
  it('無関係な兄弟タスクの完了状態は他タスクの完了操作の影響を受けない', () => {
    setup();
    const unrelatedA = uuidv7();
    const unrelatedB = uuidv7();
    applySyncOps(db, userId, [
      makeTaskOp(listId, unrelatedA, Date.now(), { title: '無関係A', completed_at: Date.now() }),
    ]);
    applySyncOps(db, userId, [makeTaskOp(listId, unrelatedB, Date.now(), { title: '無関係B' })]);

    // 全く別系統の親子タスクを操作する
    const parent = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, parent, Date.now(), { title: '親' })]);
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: parent, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
    ]);
    const child = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, child, Date.now(), { title: '子', parent_id: parent })]);

    const rowA = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(unrelatedA) as {
      completed_at: number | null;
    };
    const rowB = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(unrelatedB) as {
      completed_at: number | null;
    };
    expect(rowA.completed_at).not.toBeNull();
    expect(rowB.completed_at).toBeNull();
  });

  // 改修5回目「何も操作していないタスクのチェックボックスが勝手に外れる」の原因だったバグの回帰テスト。
  // 既に未完了の子タスクをただ編集しただけ（完了状態も親も変えていない）では、
  // 無関係な完了済み祖先タスクの完了状態を巻き戻してはいけない
  it('未完了タスクを完了状態と無関係な項目だけ編集しても、完了済み祖先は巻き戻らない', () => {
    setup();
    const parent = uuidv7();
    const child = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, parent, Date.now(), { title: '親' })]);
    applySyncOps(db, userId, [makeTaskOp(listId, child, Date.now(), { title: '子', parent_id: parent })]);
    // 子を先に完了させてから親を完了させる（hasIncompleteDescendantを満たすため）
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: child, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
    ]);
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: parent, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
    ]);
    // 子を再び未完了に戻す（親は無関係な兄弟系統として扱う想定と同じシチュエーション）
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: child, op: 'upsert', updated_at: Date.now(), fields: { completed_at: null } },
    ]);

    const parentRow = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(parent) as {
      completed_at: number | null;
    };
    expect(parentRow.completed_at).toBeNull(); // 子が未完了に戻ったので親も正しく巻き戻る

    // ここからは無関係な兄弟タスクで「別の親」を完了させ、以後その子のタイトルだけを編集する
    const otherParent = uuidv7();
    const otherChild = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, otherParent, Date.now(), { title: '別の親' })]);
    applySyncOps(db, userId, [
      makeTaskOp(listId, otherChild, Date.now(), { title: '別の子', parent_id: otherParent }),
    ]);
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: otherChild, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
    ]);
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: otherParent, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
    ]);

    // 全く無関係な、未完了のchildのタイトルだけを編集する（完了状態にも親にも触れない）
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: child, op: 'upsert', updated_at: Date.now(), fields: { title: '子（改名）' } },
    ]);

    const otherParentRow = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(otherParent) as {
      completed_at: number | null;
    };
    expect(otherParentRow.completed_at).not.toBeNull(); // 無関係な操作の影響で外れていないこと
  });

  // 改修5回目「メモ本文のフィールド単位マージ」。base_fieldsで真の同時編集を検出した場合、
  // 片方を黙って消さずgit風のコンフリクトマーカーで両方残す
  describe('フィールド単位マージ（base_fields）', () => {
    it('サーバー側の値がbaseから変わっていなければ、そのまま上書きする（衝突なし）', () => {
      setup();
      const taskId = uuidv7();
      applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { note: '元のメモ' })]);

      applySyncOps(db, userId, [
        {
          op_id: uuidv7(),
          table: 'tasks',
          id: taskId,
          op: 'upsert',
          updated_at: Date.now(),
          fields: { note: '新しいメモ' },
          base_fields: { note: '元のメモ' },
        },
      ]);

      const row = db.prepare('SELECT note FROM tasks WHERE id = ?').get(taskId) as { note: string };
      expect(row.note).toBe('新しいメモ');
    });

    it('他デバイスが自分の知らない間に同じフィールドを書き換えていたら、両方の内容を残す', () => {
      setup();
      const taskId = uuidv7();
      applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { note: '元のメモ' })]);

      // 別デバイスが先に書き換える（base無しの通常push）
      applySyncOps(db, userId, [
        {
          op_id: uuidv7(),
          table: 'tasks',
          id: taskId,
          op: 'upsert',
          updated_at: Date.now(),
          fields: { note: '他デバイスの変更' },
        },
      ]);

      // このデバイスは古い「元のメモ」をbaseとして、自分の変更をpushする
      applySyncOps(db, userId, [
        {
          op_id: uuidv7(),
          table: 'tasks',
          id: taskId,
          op: 'upsert',
          updated_at: Date.now(),
          fields: { note: '自分の変更' },
          base_fields: { note: '元のメモ' },
        },
      ]);

      const row = db.prepare('SELECT note FROM tasks WHERE id = ?').get(taskId) as { note: string };
      expect(row.note).toContain('他デバイスの変更');
      expect(row.note).toContain('自分の変更');
      expect(row.note).toContain('&lt;&lt;&lt;&lt;&lt;&lt;&lt;');
    });

    it('base_fieldsを送らない旧クライアント相当のopは従来通りLWWで上書きする', () => {
      setup();
      const taskId = uuidv7();
      applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { note: '元のメモ' })]);
      applySyncOps(db, userId, [
        {
          op_id: uuidv7(),
          table: 'tasks',
          id: taskId,
          op: 'upsert',
          updated_at: Date.now(),
          fields: { note: '別デバイスの変更' },
        },
      ]);
      applySyncOps(db, userId, [
        {
          op_id: uuidv7(),
          table: 'tasks',
          id: taskId,
          op: 'upsert',
          updated_at: Date.now(),
          fields: { note: 'base無しの上書き' },
        },
      ]);

      const row = db.prepare('SELECT note FROM tasks WHERE id = ?').get(taskId) as { note: string };
      expect(row.note).toBe('base無しの上書き');
    });
  });

  // 先行タスク（軽量な依存関係、改修13回目）
  describe('blocked_by_task_id', () => {
    it('先行タスクIDを設定・取得できる', () => {
      setup();
      const predecessorId = uuidv7();
      const taskId = uuidv7();
      applySyncOps(db, userId, [makeTaskOp(listId, predecessorId, Date.now(), { title: '先行タスク' })]);
      applySyncOps(db, userId, [
        makeTaskOp(listId, taskId, Date.now(), { title: '後続タスク', blocked_by_task_id: predecessorId }),
      ]);

      const row = db.prepare('SELECT blocked_by_task_id FROM tasks WHERE id = ?').get(taskId) as {
        blocked_by_task_id: string | null;
      };
      expect(row.blocked_by_task_id).toBe(predecessorId);
    });

    it('先行タスクが物理削除されるとblocked_by_task_idはNULLになる（ON DELETE SET NULL）', () => {
      setup();
      const predecessorId = uuidv7();
      const taskId = uuidv7();
      applySyncOps(db, userId, [makeTaskOp(listId, predecessorId, Date.now(), { title: '先行タスク' })]);
      applySyncOps(db, userId, [
        makeTaskOp(listId, taskId, Date.now(), { title: '後続タスク', blocked_by_task_id: predecessorId }),
      ]);

      db.prepare('DELETE FROM tasks WHERE id = ?').run(predecessorId);

      const row = db.prepare('SELECT blocked_by_task_id FROM tasks WHERE id = ?').get(taskId) as {
        blocked_by_task_id: string | null;
      };
      expect(row.blocked_by_task_id).toBeNull();
    });
  });

  // 改修5回目「習慣トラッキング」用の完了ログ記録
  describe('task_completionsへの記録', () => {
    it('通常タスクの完了でtask_completionsに1件記録される', () => {
      setup();
      const taskId = uuidv7();
      applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: 'タスク' })]);
      applySyncOps(db, userId, [
        { op_id: uuidv7(), table: 'tasks', id: taskId, op: 'upsert', updated_at: Date.now(), fields: { completed_at: Date.now() } },
      ]);

      const rows = db.prepare('SELECT * FROM task_completions WHERE task_id = ?').all(taskId);
      expect(rows).toHaveLength(1);
    });

    it('繰り返しタスクはcompleted_atを立てず期限を進めるだけでも1件記録される', () => {
      setup();
      const taskId = uuidv7();
      const base = Date.now();
      applySyncOps(db, userId, [
        makeTaskOp(listId, taskId, base, { title: '繰り返し', rrule: 'FREQ=DAILY', due_date: '2026-08-01' }),
      ]);
      applySyncOps(db, userId, [
        {
          op_id: uuidv7(),
          table: 'tasks',
          id: taskId,
          op: 'upsert',
          updated_at: base + 10,
          fields: { due_date: '2026-08-02', completed_at: null },
        },
      ]);

      const rows = db.prepare('SELECT * FROM task_completions WHERE task_id = ?').all(taskId);
      expect(rows).toHaveLength(1);
    });

    it('completed_at以外の無関係な編集では記録されない', () => {
      setup();
      const taskId = uuidv7();
      applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), { title: 'タスク' })]);
      applySyncOps(db, userId, [
        { op_id: uuidv7(), table: 'tasks', id: taskId, op: 'upsert', updated_at: Date.now(), fields: { title: '改名' } },
      ]);

      const rows = db.prepare('SELECT * FROM task_completions WHERE task_id = ?').all(taskId);
      expect(rows).toHaveLength(0);
    });

    it('繰り返しタスクの期限を過去へ戻す編集では記録されない', () => {
      setup();
      const taskId = uuidv7();
      const base = Date.now();
      applySyncOps(db, userId, [
        makeTaskOp(listId, taskId, base, { title: '繰り返し', rrule: 'FREQ=DAILY', due_date: '2026-08-10' }),
      ]);
      applySyncOps(db, userId, [
        {
          op_id: uuidv7(),
          table: 'tasks',
          id: taskId,
          op: 'upsert',
          updated_at: base + 10,
          fields: { due_date: '2026-08-05' },
        },
      ]);

      const rows = db.prepare('SELECT * FROM task_completions WHERE task_id = ?').all(taskId);
      expect(rows).toHaveLength(0);
    });
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

  it('deleteしたタスクをrestoreするとdeleted_atがnullに戻る', () => {
    setup();
    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), {})]);
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: taskId, op: 'delete', updated_at: Date.now(), fields: {} },
    ]);
    let row = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(taskId) as { deleted_at: number | null };
    expect(row.deleted_at).not.toBeNull();

    const res = applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: taskId, op: 'restore', updated_at: Date.now(), fields: {} },
    ]);
    expect(res.rejected).toEqual([]);
    row = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(taskId) as { deleted_at: number | null };
    expect(row.deleted_at).toBeNull();
  });

  it('存在しない行のrestoreはvalidation_failedでrejectされる', () => {
    setup();
    const op: SyncOp = {
      op_id: uuidv7(),
      table: 'tasks',
      id: uuidv7(),
      op: 'restore',
      updated_at: Date.now(),
      fields: {},
    };
    const res = applySyncOps(db, userId, [op]);
    expect(res.rejected).toEqual([{ op_id: op.op_id, reason: 'validation_failed' }]);
  });

  it('他ユーザーの行をrestoreしようとするとforbidden', () => {
    setup();
    const taskId = uuidv7();
    applySyncOps(db, userId, [makeTaskOp(listId, taskId, Date.now(), {})]);
    applySyncOps(db, userId, [
      { op_id: uuidv7(), table: 'tasks', id: taskId, op: 'delete', updated_at: Date.now(), fields: {} },
    ]);
    const otherUserId = uuidv7();
    insertTestUser(db, otherUserId);
    const res = applySyncOps(db, otherUserId, [
      { op_id: uuidv7(), table: 'tasks', id: taskId, op: 'restore', updated_at: Date.now(), fields: {} },
    ]);
    expect(res.rejected).toEqual([{ op_id: expect.any(String), reason: 'forbidden' }]);
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
