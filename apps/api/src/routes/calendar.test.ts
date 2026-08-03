import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
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

describe('calendar routes', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('フィードを作成し、一覧・失効ができる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const createRes = await app.request('/api/v1/calendar/feeds', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { token: string; url: string };
    expect(created.token).toBeTruthy();
    expect(created.url).toContain(`${created.token}.ics`);

    const listRes = await app.request('/api/v1/calendar/feeds', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    const feeds = (await listRes.json()) as { id: string; token: string }[];
    expect(feeds).toHaveLength(1);

    const deleteRes = await app.request(`/api/v1/calendar/feeds/${feeds[0]?.id}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(deleteRes.status).toBe(204);

    const listAfterRes = await app.request('/api/v1/calendar/feeds', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(await listAfterRes.json()).toHaveLength(0);
  });

  it('トークンURLは認証Cookie無しでICSを返す', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const listId = insertTestList(db, userId);
    insertTestTask(db, userId, listId, '未完了タスク');
    const app = setupApp(db);

    const createRes = await app.request('/api/v1/calendar/feeds', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { token } = (await createRes.json()) as { token: string };

    // Cookie無しでのリクエスト（カレンダーアプリを模す）
    const icsRes = await app.request(`/api/v1/calendar/${token}.ics`);
    expect(icsRes.status).toBe(200);
    expect(icsRes.headers.get('Content-Type')).toContain('text/calendar');
    const body = await icsRes.text();
    expect(body).toContain('BEGIN:VCALENDAR');
  });

  it('失効済みトークンは404', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const createRes = await app.request('/api/v1/calendar/feeds', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const { token } = (await createRes.json()) as { token: string };
    const feeds = (await (
      await app.request('/api/v1/calendar/feeds', { headers: { Cookie: `nestio_session=${sessionId}` } })
    ).json()) as { id: string }[];
    await app.request(`/api/v1/calendar/feeds/${feeds[0]?.id}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${sessionId}` },
    });

    const icsRes = await app.request(`/api/v1/calendar/${token}.ics`);
    expect(icsRes.status).toBe(404);
  });

  it('存在しないトークンは404', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/calendar/nonexistent-token.ics');
    expect(res.status).toBe(404);
  });
});
