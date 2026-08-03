import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
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

function makePkce() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

async function fullOAuthFlow(
  app: ReturnType<typeof setupApp>,
  sessionId: string,
): Promise<{ accessToken: string }> {
  const { codeVerifier, codeChallenge } = makePkce();
  const redirectUri = 'https://claude.example.com/callback';

  const registerRes = await app.request('/api/v1/mcp/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test Client', redirect_uris: [redirectUri] }),
  });
  expect(registerRes.status).toBe(201);
  const { client_id: clientId } = (await registerRes.json()) as { client_id: string };

  const authorizeUrl =
    `/api/v1/mcp/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${codeChallenge}&code_challenge_method=S256&state=xyz`;
  const getAuthorizeRes = await app.request(authorizeUrl, { headers: { Cookie: `nestio_session=${sessionId}` } });
  expect(getAuthorizeRes.status).toBe(200);
  expect(await getAuthorizeRes.text()).toContain('許可する');

  const postAuthorizeRes = await app.request('/api/v1/mcp/oauth/authorize', {
    method: 'POST',
    headers: {
      Cookie: `nestio_session=${sessionId}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      state: 'xyz',
      scope: 'read write',
    }).toString(),
    redirect: 'manual',
  });
  expect(postAuthorizeRes.status).toBe(302);
  const location = postAuthorizeRes.headers.get('Location');
  if (!location) throw new Error('no Location header');
  const code = new URL(location).searchParams.get('code');
  if (!code) throw new Error('no code in redirect');

  const tokenRes = await app.request('/api/v1/mcp/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
  return { accessToken };
}

describe('MCP OAuth + tools', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('登録→認可→トークン発行→tools/listまでの一連のフローが動く', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const { accessToken } = await fullOAuthFlow(app, sessionId);
    expect(accessToken).toBeTruthy();

    const toolsRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(toolsRes.status).toBe(200);
    const toolsBody = (await toolsRes.json()) as { result: { tools: { name: string }[] } };
    expect(toolsBody.result.tools.map((t) => t.name)).toContain('list_tasks');
    expect(toolsBody.result.tools.map((t) => t.name)).toContain('create_task');
  });

  it('write権限でcreate_taskを実行できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    // まずリストが必要
    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());

    const callRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { list_id: listId, title: 'MCP経由のタスク' } },
      }),
    });
    expect(callRes.status).toBe(200);
    const body = (await callRes.json()) as { result: { content: { text: string }[] } };
    const created = JSON.parse(body.result.content[0]?.text ?? '{}') as { id: string; title: string };
    expect(created.title).toBe('MCP経由のタスク');

    const row = db.prepare('SELECT title FROM tasks WHERE id = ?').get(created.id) as { title: string };
    expect(row.title).toBe('MCP経由のタスク');
  });

  it('不正なcode_verifierではトークンを発行しない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const { codeChallenge } = makePkce();
    const redirectUri = 'https://claude.example.com/callback';

    const registerRes = await app.request('/api/v1/mcp/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test Client', redirect_uris: [redirectUri] }),
    });
    const { client_id: clientId } = (await registerRes.json()) as { client_id: string };

    const postAuthorizeRes = await app.request('/api/v1/mcp/oauth/authorize', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        scope: 'read',
      }).toString(),
      redirect: 'manual',
    });
    const location = postAuthorizeRes.headers.get('Location') ?? '';
    const code = new URL(location).searchParams.get('code') ?? '';

    const tokenRes = await app.request('/api/v1/mcp/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: 'wrong-verifier',
      }),
    });
    expect(tokenRes.status).toBe(403);
  });

  it('read権限のトークンでcreate_taskを呼ぶとスコープ不足エラー', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const { codeVerifier, codeChallenge } = makePkce();
    const redirectUri = 'https://claude.example.com/callback';
    const registerRes = await app.request('/api/v1/mcp/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test Client', redirect_uris: [redirectUri] }),
    });
    const { client_id: clientId } = (await registerRes.json()) as { client_id: string };

    const postAuthorizeRes = await app.request('/api/v1/mcp/oauth/authorize', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        scope: 'read',
      }).toString(),
      redirect: 'manual',
    });
    const location = postAuthorizeRes.headers.get('Location') ?? '';
    const code = new URL(location).searchParams.get('code') ?? '';

    const tokenRes = await app.request('/api/v1/mcp/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

    const callRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { list_id: 'x', title: 'y' } },
      }),
    });
    const body = (await callRes.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain('insufficient scope');
  });

  it('無効なBearerトークンは401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('Bearerヘッダー無しは401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });
});
