import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList } from '../test-utils/db.js';
import { getGcBoundarySeq } from '../sync/seq.js';
import { purgeOldTombstones, purgeOldAppliedOps } from './tombstones.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function insertTask(
  db: Database.Database,
  userId: string,
  listId: string,
  seq: number,
  deletedAt: number | null,
): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, NULL, 't', '', 0, NULL, NULL, NULL, NULL, 1, ?, ?, ?, ?)`,
  ).run(id, userId, listId, Date.now(), Date.now(), deletedAt, seq);
  return id;
}

describe('purgeOldTombstones', () => {
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

  it('保持期間を過ぎたtombstoneを物理削除する', () => {
    setup();
    const oldId = insertTask(db, userId, listId, 10, Date.now() - 31 * DAY_MS);
    insertTask(db, userId, listId, 11, Date.now() - 1 * DAY_MS); // 保持期間内

    const { deletedRows } = purgeOldTombstones(db, 30);

    expect(deletedRows).toBe(1);
    expect(db.prepare('SELECT id FROM tasks WHERE id = ?').get(oldId)).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) as c FROM tasks').get()).toEqual({ c: 1 });
  });

  it('deleted_atがNULLの行（未削除）には触れない', () => {
    setup();
    insertTask(db, userId, listId, 10, null);

    const { deletedRows } = purgeOldTombstones(db, 30);

    expect(deletedRows).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as c FROM tasks').get()).toEqual({ c: 1 });
  });

  it('物理削除した行の最大seqをgc_boundary_seqに記録する', () => {
    setup();
    insertTask(db, userId, listId, 5, Date.now() - 40 * DAY_MS);
    insertTask(db, userId, listId, 8, Date.now() - 35 * DAY_MS);

    purgeOldTombstones(db, 30);

    expect(getGcBoundarySeq(db, userId)).toBe(8);
  });

  it('gc_boundary_seqは後退しない（複数回GCを回しても最大値を保持）', () => {
    setup();
    insertTask(db, userId, listId, 20, Date.now() - 40 * DAY_MS);
    purgeOldTombstones(db, 30);
    expect(getGcBoundarySeq(db, userId)).toBe(20);

    // 新たに古いseqのtombstoneができても、境界seqは後退させない
    insertTask(db, userId, listId, 3, Date.now() - 40 * DAY_MS);
    purgeOldTombstones(db, 30);
    expect(getGcBoundarySeq(db, userId)).toBe(20);
  });
});

describe('purgeOldAppliedOps', () => {
  let db: Database.Database;
  let userId: string;

  afterEach(() => db?.close());

  it('保持期間を過ぎたapplied_opsを削除する', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);

    const oldOpId = uuidv7();
    const recentOpId = uuidv7();
    db.prepare('INSERT INTO applied_ops (op_id, user_id, applied_at, result_seq) VALUES (?, ?, ?, 1)').run(
      oldOpId,
      userId,
      Date.now() - 31 * DAY_MS,
    );
    db.prepare('INSERT INTO applied_ops (op_id, user_id, applied_at, result_seq) VALUES (?, ?, ?, 2)').run(
      recentOpId,
      userId,
      Date.now() - 1 * DAY_MS,
    );

    const { deletedRows } = purgeOldAppliedOps(db, 30);

    expect(deletedRows).toBe(1);
    expect(db.prepare('SELECT op_id FROM applied_ops').all()).toEqual([{ op_id: recentOpId }]);
  });
});
