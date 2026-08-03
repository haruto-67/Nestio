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

describe('push routes', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('GET /push/vapid-public-key は認証不要で鍵を返す', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/push/vapid-public-key');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { public_key: string };
    expect(typeof body.public_key).toBe('string');
  });

  it('購読の登録・解除ができる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const subscribeRes = await app.request('/api/v1/push/subscribe', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      }),
    });
    expect(subscribeRes.status).toBe(201);

    const row = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').get(userId) as {
      endpoint: string;
    };
    expect(row.endpoint).toBe('https://push.example.com/abc');

    const unsubscribeRes = await app.request('/api/v1/push/subscribe', {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/abc' }),
    });
    expect(unsubscribeRes.status).toBe(204);

    const rowsAfter = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    expect(rowsAfter).toHaveLength(0);
  });

  it('ポモドーロの予約と取消ができる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const scheduleRes = await app.request('/api/v1/pomodoro/schedule', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_sec: 1500 }),
    });
    expect(scheduleRes.status).toBe(201);
    const { id } = (await scheduleRes.json()) as { id: string };

    const cancelRes = await app.request(`/api/v1/pomodoro/schedule/${id}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(cancelRes.status).toBe(204);

    const cancelAgainRes = await app.request(`/api/v1/pomodoro/schedule/${id}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(cancelAgainRes.status).toBe(404);
  });

  it('未認証でのsubscribeは401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/x', keys: { p256dh: 'a', auth: 'b' } }),
    });
    expect(res.status).toBe(401);
  });
});
