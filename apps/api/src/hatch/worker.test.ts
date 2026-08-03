import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { enqueueTriggerRun } from './queue.js';
import { processOneRun } from './worker.js';

function insertTrigger(
  db: Database.Database,
  userId: string,
  actionKey = 'push_notify',
  paramsJson = '{"title":"t","body":"b"}',
): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO triggers (id, user_id, name, event, condition_json, action_key, params_json, enabled, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, 'test trigger', 'task_completed', '{}', ?, ?, 1, ?, ?, NULL, 1)`,
  ).run(id, userId, actionKey, paramsJson, Date.now(), Date.now());
  return id;
}

describe('processOneRun', () => {
  let db: Database.Database;
  let userId: string;

  afterEach(() => db?.close());

  function setup() {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
  }

  it('キューが空なら何もしない', async () => {
    setup();
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    await expect(processOneRun(db, env, logger)).resolves.not.toThrow();
  });

  it('成功したジョブはsucceededになる', async () => {
    setup();
    const triggerId = insertTrigger(db, userId);
    enqueueTriggerRun(db, userId, triggerId, null);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    await processOneRun(db, env, logger);

    const row = db.prepare('SELECT status, output FROM trigger_runs WHERE trigger_id = ?').get(triggerId) as {
      status: string;
      output: string;
    };
    expect(row.status).toBe('succeeded');
    expect(row.output).toBe('push sent');
  });

  it('トリガーが削除済みなら失敗しqueuedに戻る（リトライ対象）', async () => {
    setup();
    const triggerId = insertTrigger(db, userId);
    enqueueTriggerRun(db, userId, triggerId, null);
    db.prepare('UPDATE triggers SET deleted_at = ? WHERE id = ?').run(Date.now(), triggerId);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    await processOneRun(db, env, logger);

    const row = db.prepare('SELECT status, error FROM trigger_runs WHERE trigger_id = ?').get(triggerId) as {
      status: string;
      error: string;
    };
    expect(row.status).toBe('queued');
    expect(row.error).toContain('trigger not found');
  });

  it('未知のaction_keyは失敗しqueuedに戻る（リトライ）', async () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'unknown_action', '{}');
    enqueueTriggerRun(db, userId, triggerId, null);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    await processOneRun(db, env, logger);

    const row = db.prepare('SELECT status, error, attempt FROM trigger_runs WHERE trigger_id = ?').get(
      triggerId,
    ) as { status: string; error: string; attempt: number };
    expect(row.status).toBe('queued');
    expect(row.error).toContain('unsupported action');
    expect(row.attempt).toBe(1);
  });

  it('subject_idが必須のアクションでnullが渡されると失敗する', async () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'set_priority', '{"priority":2}');
    enqueueTriggerRun(db, userId, triggerId, null);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    await processOneRun(db, env, logger);

    const row = db.prepare('SELECT status, error FROM trigger_runs WHERE trigger_id = ?').get(triggerId) as {
      status: string;
      error: string;
    };
    expect(row.status).toBe('queued');
    expect(row.error).toContain('subject task is required');
  });
});
