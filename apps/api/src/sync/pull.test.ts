import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import { raiseGcBoundarySeq } from './seq.js';
import { pullChanges } from './pull.js';

describe('pullChanges', () => {
  let db: Database.Database;
  let userId: string;

  afterEach(() => db?.close());

  it('通常時はchangesを返す', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    insertTestTask(db, userId, listId);

    const result = pullChanges(db, userId, 0, 500);

    expect(result.full_resync_required).toBeUndefined();
    expect(result.changes.tasks).toHaveLength(1);
  });

  it('sinceがgc_boundary_seqより古い場合はfull_resync_requiredを返す', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    raiseGcBoundarySeq(db, userId, 100);

    const result = pullChanges(db, userId, 50, 500);

    expect(result.full_resync_required).toBe(true);
    expect(result.changes).toEqual({});
  });

  it('sinceがgc_boundary_seq以上なら通常通り取得できる', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    raiseGcBoundarySeq(db, userId, 100);

    const result = pullChanges(db, userId, 100, 500);

    expect(result.full_resync_required).toBeUndefined();
  });

  it('since=0（初回同期）はgc_boundary_seqの影響を受けない', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    raiseGcBoundarySeq(db, userId, 100);

    const result = pullChanges(db, userId, 0, 500);

    expect(result.full_resync_required).toBeUndefined();
  });
});
