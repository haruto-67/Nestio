import { describe, expect, it, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { exchangeCodeForUserInfo } from '../auth/google.js';

vi.mock('../auth/google.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/google.js')>();
  return { ...actual, exchangeCodeForUserInfo: vi.fn() };
});

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

  it('GET /auth/sessions は現在のセッションが古い場合でも常に先頭に来る（改修15回目）', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const currentSessionId = insertSession(db, userId, Date.now() - 10_000);
    const newerSessionId = insertSession(db, userId, Date.now());

    const app = setupApp();
    const res = await app.request('/api/v1/auth/sessions', {
      headers: { Cookie: `nestio_session=${currentSessionId}` },
    });
    const body = (await res.json()) as { id: string; is_current: boolean }[];
    expect(body.map((s) => s.id)).toEqual([currentSessionId, newerSessionId]);
    expect(body[0]?.is_current).toBe(true);
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

// 改修17回目：MCPの認可画面（GET /mcp/oauth/authorize）が未ログインだった場合、
// Googleログインを経由して元の画面に戻れるようにするための return_to 対応
describe('auth google login のreturn_to', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  function setupApp(adminEmail = '') {
    const env = loadEnv({
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      ADMIN_EMAIL: adminEmail,
    } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);
    return createApp(env, db, logger);
  }

  function extractCookieValue(setCookies: string[], name: string): string | undefined {
    return setCookies.find((c) => c.startsWith(`${name}=`))?.split(';')[0]?.split('=')[1];
  }

  it('return_toが/始まりのパスならCookieに保存される', async () => {
    db = createTestDb();
    const app = setupApp();

    const res = await app.request(
      `/api/v1/auth/google?return_to=${encodeURIComponent('/api/v1/mcp/oauth/authorize?foo=bar')}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('nestio_oauth_return_to=') && c.includes('mcp'))).toBe(true);
  });

  it('return_toが/始まりでなければ無視される（オープンリダイレクト対策）', async () => {
    db = createTestDb();
    const app = setupApp();

    const res = await app.request(
      `/api/v1/auth/google?return_to=${encodeURIComponent('https://evil.example.com/steal')}`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('nestio_oauth_return_to='))).toBe(false);
  });

  it('return_to省略時もCookieを付けずに正常にリダイレクトする', async () => {
    db = createTestDb();
    const app = setupApp();

    const res = await app.request('/api/v1/auth/google', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith('nestio_oauth_return_to='))).toBe(false);
    expect(setCookies.some((c) => c.startsWith('nestio_oauth_state='))).toBe(true);
  });

  // 改修17回目フォローアップ2：claude.aiからのMCPコネクタ連携で、Googleログイン後に
  // 認可画面へ戻れず無限ループする不具合の再現・修正確認
  it('return_to指定でログインすると、302ではなくbounceページ（JSナビゲーション）で戻り先へ遷移する', async () => {
    db = createTestDb();
    const app = setupApp('user@example.com'); // 管理者扱いにして申請フローをスキップする

    const startRes = await app.request(
      `/api/v1/auth/google?return_to=${encodeURIComponent('/api/v1/mcp/oauth/authorize?foo=bar')}`,
      { redirect: 'manual' },
    );
    const startCookies = startRes.headers.getSetCookie();
    const cookieHeader = startCookies.map((c) => c.split(';')[0]).join('; ');
    const state = extractCookieValue(startCookies, 'nestio_oauth_state');

    vi.mocked(exchangeCodeForUserInfo).mockResolvedValueOnce({
      sub: 'google-sub-1',
      email: 'user@example.com',
      email_verified: true,
      name: 'Test User',
    });

    const callbackRes = await app.request(`/api/v1/auth/google/callback?code=dummy-code&state=${state}`, {
      headers: { Cookie: cookieHeader },
    });
    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toContain('location.replace(');
    expect(html).toContain('/api/v1/mcp/oauth/authorize?foo=bar');

    // 302ではなくHTMLレスポンスでも、セッションCookie自体はこの時点で発行されている
    const callbackCookies = callbackRes.headers.getSetCookie();
    expect(callbackCookies.some((c) => c.startsWith('nestio_session='))).toBe(true);
  });

  it('return_to無しでログインすると、従来通り302でトップページへリダイレクトする', async () => {
    db = createTestDb();
    const app = setupApp('user@example.com');

    const startRes = await app.request('/api/v1/auth/google', { redirect: 'manual' });
    const startCookies = startRes.headers.getSetCookie();
    const cookieHeader = startCookies.map((c) => c.split(';')[0]).join('; ');
    const state = extractCookieValue(startCookies, 'nestio_oauth_state');

    vi.mocked(exchangeCodeForUserInfo).mockResolvedValueOnce({
      sub: 'google-sub-2',
      email: 'user@example.com',
      email_verified: true,
      name: 'Test User',
    });

    const callbackRes = await app.request(`/api/v1/auth/google/callback?code=dummy-code&state=${state}`, {
      headers: { Cookie: cookieHeader },
      redirect: 'manual',
    });
    expect(callbackRes.status).toBe(302);
  });
});
