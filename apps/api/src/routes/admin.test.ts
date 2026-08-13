import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';

const ADMIN_EMAIL = 'admin@example.com';

function insertSession(db: Database.Database, userId: string): string {
  const sessionId = 'test-session-' + uuidv7();
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, Date.now() + 100_000, Date.now());
  return sessionId;
}

function insertAccessRequest(db: Database.Database, email = 'newbie@example.com'): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO access_requests (id, google_sub, email, display_name, avatar_url, status, requested_at)
     VALUES (?, ?, ?, ?, NULL, 'pending', ?)`,
  ).run(id, `sub-${id}`, email, 'Newbie', Date.now());
  return id;
}

describe('admin routes', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  function setupApp() {
    const env = loadEnv({ NODE_ENV: 'test', ADMIN_EMAIL } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);
    return createApp(env, db, logger);
  }

  it('管理者以外は403', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp();

    const res = await app.request('/api/v1/admin/access-requests', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(res.status).toBe(403);
  });

  it('未認証は401', async () => {
    db = createTestDb();
    const app = setupApp();
    const res = await app.request('/api/v1/admin/access-requests');
    expect(res.status).toBe(401);
  });

  it('管理者は申請一覧を取得でき、承認するとusersに登録される', async () => {
    db = createTestDb();
    const adminId = uuidv7();
    db.prepare(
      'INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(adminId, `sub-${adminId}`, ADMIN_EMAIL, 'Admin', Date.now());
    const sessionId = insertSession(db, adminId);
    const requestId = insertAccessRequest(db);
    const app = setupApp();

    const listRes = await app.request('/api/v1/admin/access-requests?status=pending', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string; email: string }[];
    expect(list.map((r) => r.id)).toContain(requestId);

    const approveRes = await app.request(`/api/v1/admin/access-requests/${requestId}/approve`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(approveRes.status).toBe(200);
    const { user_id } = (await approveRes.json()) as { user_id: string };
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id) as { email: string } | undefined;
    expect(user?.email).toBe('newbie@example.com');

    const row = db.prepare('SELECT status FROM access_requests WHERE id = ?').get(requestId) as {
      status: string;
    };
    expect(row.status).toBe('approved');

    // 二重承認は409
    const secondApproveRes = await app.request(`/api/v1/admin/access-requests/${requestId}/approve`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(secondApproveRes.status).toBe(409);
  });

  it('却下するとusersには登録されず、statusがrejectedになる', async () => {
    db = createTestDb();
    const adminId = uuidv7();
    db.prepare(
      'INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(adminId, `sub-${adminId}`, ADMIN_EMAIL, 'Admin', Date.now());
    const sessionId = insertSession(db, adminId);
    const requestId = insertAccessRequest(db, 'rejected-person@example.com');
    const app = setupApp();

    const res = await app.request(`/api/v1/admin/access-requests/${requestId}/reject`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(res.status).toBe(204);

    const row = db.prepare('SELECT status FROM access_requests WHERE id = ?').get(requestId) as {
      status: string;
    };
    expect(row.status).toBe('rejected');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('rejected-person@example.com');
    expect(user).toBeUndefined();
  });
});
