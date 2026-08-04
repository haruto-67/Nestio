import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { purgeOldTriggerRuns } from './trigger-runs.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('purgeOldTriggerRuns', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  function insertTrigger(userId: string): string {
    const id = uuidv7();
    db.prepare(
      `INSERT INTO triggers (id, user_id, name, event, condition_json, action_key, params_json, enabled, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, 't', 'task_created', '{}', 'claude_prompt', '{}', 1, ?, ?, NULL, 1)`,
    ).run(id, userId, Date.now(), Date.now());
    return id;
  }

  function insertRun(triggerId: string, userId: string, createdAt: number): void {
    db.prepare(
      `INSERT INTO trigger_runs (id, trigger_id, user_id, status, subject_id, attempt, output, error, started_at, finished_at, created_at)
       VALUES (?, ?, ?, 'succeeded', NULL, 0, '', NULL, ?, ?, ?)`,
    ).run(uuidv7(), triggerId, userId, createdAt, createdAt, createdAt);
  }

  it('保持期間より古い実行ログだけ削除し、新しいものは残す', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const triggerId = insertTrigger(userId);

    insertRun(triggerId, userId, Date.now() - 40 * DAY_MS);
    insertRun(triggerId, userId, Date.now() - 1 * DAY_MS);

    const { deletedRows } = purgeOldTriggerRuns(db, 30);
    expect(deletedRows).toBe(1);

    const remaining = db.prepare('SELECT COUNT(*) as c FROM trigger_runs').get() as { c: number };
    expect(remaining.c).toBe(1);
  });
});
