import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';

function insertSession(db: Database.Database, userId: string): string {
  const sessionId = 'test-session-' + uuidv7();
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, Date.now() + 100_000, Date.now());
  return sessionId;
}

describe('export route', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  function setupApp() {
    const env = loadEnv({ NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);
    return createApp(env, db, logger);
  }

  it('GET /export は自分のタスク・リストをJSONで返す（他ユーザーの行は含まない）', async () => {
    db = createTestDb();
    const userId = uuidv7();
    const otherUserId = uuidv7();
    insertTestUser(db, userId);
    insertTestUser(db, otherUserId);
    const sessionId = insertSession(db, userId);

    const listId = uuidv7();
    db.prepare(
      'INSERT INTO lists (id, user_id, name, sort_order, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(listId, userId, '自分のリスト', 1, Date.now(), Date.now(), 1);

    const otherListId = uuidv7();
    db.prepare(
      'INSERT INTO lists (id, user_id, name, sort_order, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(otherListId, otherUserId, '他人のリスト', 1, Date.now(), Date.now(), 1);

    const app = setupApp();
    const res = await app.request('/api/v1/export', { headers: { Cookie: `nestio_session=${sessionId}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: { lists: { name: string }[] } };
    expect(body.tables.lists.map((l) => l.name)).toEqual(['自分のリスト']);
  });

  it('未認証だと401', async () => {
    db = createTestDb();
    const app = setupApp();
    const res = await app.request('/api/v1/export');
    expect(res.status).toBe(401);
  });
});
