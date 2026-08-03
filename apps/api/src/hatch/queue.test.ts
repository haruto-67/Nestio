import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { enqueueTriggerRun, claimNextQueuedRun, markRunSucceeded, markRunFailed, listTriggerRuns } from './queue.js';

function insertTrigger(db: Database.Database, userId: string): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO triggers (id, user_id, name, event, condition_json, action_key, params_json, enabled, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, 'test trigger', 'task_completed', '{}', 'push_notify', '{}', 1, ?, ?, NULL, 1)`,
  ).run(id, userId, Date.now(), Date.now());
  return id;
}

describe('hatch queue', () => {
  let db: Database.Database;
  let userId: string;
  let triggerId: string;

  afterEach(() => db?.close());

  function setup() {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    triggerId = insertTrigger(db, userId);
  }

  it('enqueueしたジョブをclaimできる', () => {
    setup();
    enqueueTriggerRun(db, userId, triggerId, 'task-1');

    const claimed = claimNextQueuedRun(db);
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('running');
    expect(claimed?.subject_id).toBe('task-1');
    expect(claimed?.attempt).toBe(1);
  });

  it('同時実行数1：runningのジョブがあると次をclaimしない', () => {
    setup();
    enqueueTriggerRun(db, userId, triggerId, 'task-1');
    enqueueTriggerRun(db, userId, triggerId, 'task-2');

    const first = claimNextQueuedRun(db);
    expect(first).not.toBeNull();

    const second = claimNextQueuedRun(db);
    expect(second).toBeNull();
  });

  it('成功したジョブが完了すると次のジョブをclaimできる', () => {
    setup();
    enqueueTriggerRun(db, userId, triggerId, 'task-1');
    enqueueTriggerRun(db, userId, triggerId, 'task-2');

    const first = claimNextQueuedRun(db);
    if (!first) throw new Error('unreachable');
    markRunSucceeded(db, first.id, 'done');

    const second = claimNextQueuedRun(db);
    expect(second).not.toBeNull();
    expect(second?.subject_id).toBe('task-2');
  });

  it('失敗したジョブはリトライ上限まで再度queuedに戻る', () => {
    setup();
    enqueueTriggerRun(db, userId, triggerId, 'task-1');

    let run = claimNextQueuedRun(db);
    if (!run) throw new Error('unreachable');
    markRunFailed(db, run.id, run.attempt, 'error 1', false);

    // まだリトライ上限(3回)未満なのでqueuedに戻り、再度claimできる
    run = claimNextQueuedRun(db);
    expect(run).not.toBeNull();
    expect(run?.attempt).toBe(2);

    if (!run) throw new Error('unreachable');
    markRunFailed(db, run.id, run.attempt, 'error 2', false);
    run = claimNextQueuedRun(db);
    expect(run?.attempt).toBe(3);

    if (!run) throw new Error('unreachable');
    markRunFailed(db, run.id, run.attempt, 'error 3', false);

    // リトライ上限に達したのでもうqueuedに戻らない
    run = claimNextQueuedRun(db);
    expect(run).toBeNull();

    const rows = db.prepare('SELECT status FROM trigger_runs').all() as { status: string }[];
    expect(rows[0]?.status).toBe('failed');
  });

  it('タイムアウトはtimeoutステータスで確定する', () => {
    setup();
    enqueueTriggerRun(db, userId, triggerId, 'task-1');
    let run = claimNextQueuedRun(db);
    for (let i = 0; i < 3; i++) {
      if (!run) throw new Error('unreachable');
      markRunFailed(db, run.id, run.attempt, 'timeout', true);
      run = claimNextQueuedRun(db);
    }
    const rows = db.prepare('SELECT status FROM trigger_runs').all() as { status: string }[];
    expect(rows[0]?.status).toBe('timeout');
  });

  it('listTriggerRunsでtrigger_idフィルタが効く', () => {
    setup();
    const otherTriggerId = insertTrigger(db, userId);
    enqueueTriggerRun(db, userId, triggerId, 'task-1');
    enqueueTriggerRun(db, userId, otherTriggerId, 'task-2');

    const filtered = listTriggerRuns(db, userId, triggerId, 50) as { trigger_id: string }[];
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.trigger_id).toBe(triggerId);

    const all = listTriggerRuns(db, userId, null, 50);
    expect(all).toHaveLength(2);
  });
});
