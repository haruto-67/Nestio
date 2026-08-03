import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { enqueueTriggerRun } from '../hatch/queue.js';

function setupApp(db: Database.Database) {
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
  const logger = createLogger(env);
  return createApp(env, db, logger);
}

function insertSession(db: Database.Database, userId: string): string {
  const sessionId = 'test-session-' + uuidv7();
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, Date.now() + 100_000, Date.now());
  return sessionId;
}

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

describe('hatch routes', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('GET /hatch/actions はACTION_METADATAの一覧を返す', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const res = await app.request('/api/v1/hatch/actions', { headers: { Cookie: `nestio_session=${sessionId}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string }[];
    expect(body.some((a) => a.key === 'push_notify')).toBe(true);
    expect(body.some((a) => a.key === 'claude_prompt')).toBe(true);
  });

  it('GET /hatch/actions は未認証だと401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/hatch/actions');
    expect(res.status).toBe(401);
  });

  it('GET /hatch/runs はtrigger_idでフィルタできる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const triggerId = insertTrigger(db, userId);
    const otherTriggerId = insertTrigger(db, userId);
    enqueueTriggerRun(db, userId, triggerId, null);
    enqueueTriggerRun(db, userId, otherTriggerId, null);
    const app = setupApp(db);

    const res = await app.request(`/api/v1/hatch/runs?trigger_id=${triggerId}`, {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const runs = (await res.json()) as { trigger_id: string }[];
    expect(runs).toHaveLength(1);
    expect(runs[0]?.trigger_id).toBe(triggerId);
  });

  it('POST /hatch/:triggerId/test はアクションを即時実行し結果を返す', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const triggerId = insertTrigger(db, userId);
    const app = setupApp(db);

    const res = await app.request(`/api/v1/hatch/${triggerId}/test`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { output: string };
    expect(body.output).toBe('push sent');
  });

  it('POST /hatch/:triggerId/test は存在しないトリガーで404', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const res = await app.request(`/api/v1/hatch/${uuidv7()}/test`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('POST /hatch/:triggerId/test は他ユーザーのトリガーにアクセスできない', async () => {
    db = createTestDb();
    const ownerId = uuidv7();
    insertTestUser(db, ownerId);
    const triggerId = insertTrigger(db, ownerId);

    const otherId = uuidv7();
    insertTestUser(db, otherId);
    const otherSessionId = insertSession(db, otherId);
    const app = setupApp(db);

    const res = await app.request(`/api/v1/hatch/${triggerId}/test`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${otherSessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('POST /hatch/:triggerId/test はアクション失敗時に500系エラーを返す', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const triggerId = insertTrigger(db, userId, 'set_priority', '{"priority":2}');
    const app = setupApp(db);

    const res = await app.request(`/api/v1/hatch/${triggerId}/test`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
