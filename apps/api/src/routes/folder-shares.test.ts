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

function insertFolder(db: Database.Database, userId: string): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO folders (id, user_id, name, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, 'フォルダ', 1, ?, ?, NULL, 1)`,
  ).run(id, userId, Date.now(), Date.now());
  return id;
}

describe('folder-shares routes', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('招待→承諾→一覧→解除の一連の流れが動く', async () => {
    db = createTestDb();
    const ownerId = uuidv7();
    const editorId = uuidv7();
    insertTestUser(db, ownerId);
    insertTestUser(db, editorId);
    const folderId = insertFolder(db, ownerId);
    const ownerSession = insertSession(db, ownerId);
    const editorSession = insertSession(db, editorId);
    const app = setupApp(db);

    const inviteRes = await app.request('/api/v1/folder-shares', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${ownerSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folderId, invited_email: `${editorId}@example.com` }),
    });
    expect(inviteRes.status).toBe(201);
    const share = (await inviteRes.json()) as { id: string; status: string };
    expect(share.status).toBe('pending');

    const incomingRes = await app.request('/api/v1/folder-shares/incoming', {
      headers: { Cookie: `nestio_session=${editorSession}` },
    });
    const incoming = (await incomingRes.json()) as { folder_name: string; owner_email: string }[];
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.folder_name).toBe('フォルダ');

    const acceptRes = await app.request(`/api/v1/folder-shares/${share.id}/accept`, {
      method: 'POST',
      headers: { Cookie: `nestio_session=${editorSession}` },
    });
    expect(acceptRes.status).toBe(200);
    expect(((await acceptRes.json()) as { status: string }).status).toBe('accepted');

    const outgoingRes = await app.request('/api/v1/folder-shares/outgoing', {
      headers: { Cookie: `nestio_session=${ownerSession}` },
    });
    expect(await outgoingRes.json()).toHaveLength(1);

    const revokeRes = await app.request(`/api/v1/folder-shares/${share.id}`, {
      method: 'DELETE',
      headers: { Cookie: `nestio_session=${ownerSession}` },
    });
    expect(revokeRes.status).toBe(204);
  });

  it('他人のフォルダは共有できない（forbidden）', async () => {
    db = createTestDb();
    const ownerId = uuidv7();
    const strangerId = uuidv7();
    const targetId = uuidv7();
    insertTestUser(db, ownerId);
    insertTestUser(db, strangerId);
    insertTestUser(db, targetId);
    const folderId = insertFolder(db, ownerId);
    const strangerSession = insertSession(db, strangerId);
    const app = setupApp(db);

    const res = await app.request('/api/v1/folder-shares', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${strangerSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folderId, invited_email: `${targetId}@example.com` }),
    });
    expect(res.status).toBe(403);
  });

  it('未認証は401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/folder-shares/incoming');
    expect(res.status).toBe(401);
  });
});
