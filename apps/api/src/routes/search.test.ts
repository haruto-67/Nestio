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

function insertList(db: Database.Database, userId: string): string {
  const listId = uuidv7();
  db.prepare(
    `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
  ).run(listId, userId, Date.now(), Date.now());
  return listId;
}

function insertTask(
  db: Database.Database,
  userId: string,
  listId: string,
  title: string,
  opts: { note?: string; deletedAt?: number | null; seq?: number } = {},
): string {
  const taskId = uuidv7();
  db.prepare(
    `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, NULL, ?, ?, 0, NULL, NULL, NULL, NULL, 1, ?, ?, ?, ?)`,
  ).run(taskId, userId, listId, title, opts.note ?? '', Date.now(), Date.now(), opts.deletedAt ?? null, opts.seq ?? 1);
  return taskId;
}

function insertNote(db: Database.Database, userId: string, title: string, body = ''): string {
  const noteId = uuidv7();
  db.prepare(
    `INSERT INTO notes (id, user_id, title, body, color, pinned, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, ?, '#FFF7C0', 0, 1, ?, ?, NULL, 1)`,
  ).run(noteId, userId, title, body, Date.now(), Date.now());
  return noteId;
}

describe('GET /api/v1/search', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('3文字以上のクエリはFTS5でタスクとメモを横断ヒットする', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const listId = insertList(db, userId);
    const taskId = insertTask(db, userId, listId, '牛乳を買いに行く');
    const noteId = insertNote(db, userId, '買い物メモ', '牛乳とパンを買う');

    const app = setupApp(db);
    const res = await app.request('/api/v1/search?q=牛乳', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: { id: string }[]; notes: { id: string }[] };
    expect(body.tasks.map((t) => t.id)).toContain(taskId);
    expect(body.notes.map((n) => n.id)).toContain(noteId);
  });

  it('2文字以下はLIKEにフォールバックする', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const listId = insertList(db, userId);
    const taskId = insertTask(db, userId, listId, '牛乳を買う');

    const app = setupApp(db);
    const res = await app.request('/api/v1/search?q=牛乳', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: { id: string }[] };
    expect(body.tasks.map((t) => t.id)).toContain(taskId);
  });

  it('削除済みタスクはヒットしない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const listId = insertList(db, userId);
    insertTask(db, userId, listId, '削除されたタスク', { deletedAt: Date.now() });

    const app = setupApp(db);
    const res = await app.request('/api/v1/search?q=削除された', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    const body = (await res.json()) as { tasks: { id: string }[] };
    expect(body.tasks).toHaveLength(0);
  });

  it('未認証は401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/search?q=test');
    expect(res.status).toBe(401);
  });
});
