import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';

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

describe('api-keys routes', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('APIキーを発行し、一覧・失効ができる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '自動化スクリプト', scope: 'write' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; key: string; name: string; scope: string };
    expect(created.key).toMatch(/^nestio_sk_/);
    expect(created.scope).toBe('read write');

    const listRes = await app.request('/api/v1/api-keys', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    const keys = (await listRes.json()) as { id: string; name: string }[];
    expect(keys).toHaveLength(1);
    expect(keys[0]?.name).toBe('自動化スクリプト');
    // 一覧レスポンスに平文キーが含まれない（key_hashも含まれない）ことを確認
    expect(JSON.stringify(keys)).not.toContain(created.key);

    const deleteRes = await app.request(`/api/v1/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(deleteRes.status).toBe(204);

    const listAfterRes = await app.request('/api/v1/api-keys', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(await listAfterRes.json()).toHaveLength(0);
  });

  it('未認証では401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/api-keys');
    expect(res.status).toBe(401);
  });

  it('他ユーザーのキーは失効できない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    const otherUserId = uuidv7();
    insertTestUser(db, userId);
    insertTestUser(db, otherUserId);
    const sessionId = insertSession(db, userId);
    const otherSessionId = insertSession(db, otherUserId);
    const app = setupApp(db);

    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'キー' }),
    });
    const created = (await createRes.json()) as { id: string };

    const deleteRes = await app.request(`/api/v1/api-keys/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${otherSessionId}` },
    });
    expect(deleteRes.status).toBe(404);
  });
});
