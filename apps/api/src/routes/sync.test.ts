import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { subscribeSse } from '../sync/sse-hub.js';
import { inviteToList, acceptShare } from '../shares/list-shares.js';

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

describe('sync routes: リスト共有時のSSE通知（改修22回目）', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('ownerがpushすると共有先editorにもbumpが届く', async () => {
    db = createTestDb();
    const ownerId = uuidv7();
    const editorId = uuidv7();
    insertTestUser(db, ownerId);
    insertTestUser(db, editorId);
    const listId = insertTestList(db, ownerId);
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    acceptShare(db, editorId, share.id);
    const ownerSession = insertSession(db, ownerId);
    const app = setupApp(db);

    const received: string[] = [];
    const unsubscribe = subscribeSse(editorId, { push: (payload) => received.push(payload) });

    try {
      const res = await app.request('/api/v1/sync/push', {
        method: 'POST',
        headers: { Cookie: `nestio_session=${ownerSession}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: uuidv7(),
          ops: [
            {
              op_id: uuidv7(),
              table: 'tasks',
              id: uuidv7(),
              op: 'upsert',
              updated_at: Date.now(),
              fields: { list_id: listId, title: '共有タスク', sort_order: 1 },
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
      expect(received).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it('共有していないユーザーにはbumpが届かない', async () => {
    db = createTestDb();
    const ownerId = uuidv7();
    const strangerId = uuidv7();
    insertTestUser(db, ownerId);
    insertTestUser(db, strangerId);
    const listId = insertTestList(db, ownerId);
    const ownerSession = insertSession(db, ownerId);
    const app = setupApp(db);

    const received: string[] = [];
    const unsubscribe = subscribeSse(strangerId, { push: (payload) => received.push(payload) });

    try {
      await app.request('/api/v1/sync/push', {
        method: 'POST',
        headers: { Cookie: `nestio_session=${ownerSession}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: uuidv7(),
          ops: [
            {
              op_id: uuidv7(),
              table: 'tasks',
              id: uuidv7(),
              op: 'upsert',
              updated_at: Date.now(),
              fields: { list_id: listId, title: '共有していないタスク', sort_order: 1 },
            },
          ],
        }),
      });
      expect(received).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });
});
