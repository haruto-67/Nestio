import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';

function insertSession(db: Database.Database, userId: string, createdAt = Date.now()): string {
  const sessionId = 'test-session-' + uuidv7();
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, Date.now() + 100_000, createdAt);
  return sessionId;
}

describe('auth sessions routes', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  function setupApp(adminEmail = '') {
    const env = loadEnv({ NODE_ENV: 'test', ADMIN_EMAIL: adminEmail } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);
    return createApp(env, db, logger);
  }

  it('GET /auth/me はADMIN_EMAILと一致する場合のみis_admin=trueを返す', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);

    const nonAdminApp = setupApp('someone-else@example.com');
    const nonAdminRes = await nonAdminApp.request('/api/v1/auth/me', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect((await nonAdminRes.json()) as { is_admin: boolean }).toMatchObject({ is_admin: false });

    const adminApp = setupApp(`${userId}@example.com`);
    const adminRes = await adminApp.request('/api/v1/auth/me', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect((await adminRes.json()) as { is_admin: boolean }).toMatchObject({ is_admin: true });
  });

  it('GET /auth/sessions は自分のセッション一覧を新しい順で返し、現在のセッションにis_currentを付ける', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const olderSessionId = insertSession(db, userId, Date.now() - 10_000);
    const currentSessionId = insertSession(db, userId, Date.now());

    const app = setupApp();
    const res = await app.request('/api/v1/auth/sessions', {
      headers: { Cookie: `nestio_session=${currentSessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; is_current: boolean }[];
    expect(body.map((s) => s.id)).toEqual([currentSessionId, olderSessionId]);
    expect(body[0]?.is_current).toBe(true);
    expect(body[1]?.is_current).toBe(false);
  });

  it('DELETE /auth/sessions/:id で他デバイスのセッションを失効できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const currentSessionId = insertSession(db, userId);
    const otherDeviceSessionId = insertSession(db, userId);

    const app = setupApp();
    const res = await app.request(`/api/v1/auth/sessions/${otherDeviceSessionId}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${currentSessionId}` },
    });
    expect(res.status).toBe(204);

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(otherDeviceSessionId);
    expect(row).toBeUndefined();
  });

  it('他ユーザーのセッションは失効させられない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    const otherUserId = uuidv7();
    insertTestUser(db, userId);
    insertTestUser(db, otherUserId);
    const currentSessionId = insertSession(db, userId);
    const otherUsersSessionId = insertSession(db, otherUserId);

    const app = setupApp();
    const res = await app.request(`/api/v1/auth/sessions/${otherUsersSessionId}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${currentSessionId}` },
    });
    expect(res.status).toBe(403);

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(otherUsersSessionId);
    expect(row).toBeDefined();
  });
});
