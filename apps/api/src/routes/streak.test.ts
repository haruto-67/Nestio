import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
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

function insertCompletion(db: Database.Database, userId: string, taskId: string, completedAt: number): void {
  db.prepare('INSERT INTO task_completions (id, user_id, task_id, completed_at) VALUES (?, ?, ?, ?)').run(
    uuidv7(),
    userId,
    taskId,
    completedAt,
  );
}

describe('streak route', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  function setupApp() {
    const env = loadEnv({ NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);
    return createApp(env, db, logger);
  }

  it('毎日連続で完了しているタスクのstreakを計算する', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = insertTestTask(db, userId, listId, '毎日タスク');
    db.prepare('UPDATE tasks SET rrule = ? WHERE id = ?').run('FREQ=DAILY', taskId);
    const sessionId = insertSession(db, userId);

    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    insertCompletion(db, userId, taskId, now);
    insertCompletion(db, userId, taskId, now - dayMs);
    insertCompletion(db, userId, taskId, now - 2 * dayMs);
    // 4日以上前の分は間隔が空きすぎているのでstreakに含まれない
    insertCompletion(db, userId, taskId, now - 10 * dayMs);

    const app = setupApp();
    const res = await app.request(`/api/v1/tasks/${taskId}/streak`, {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { streak: number; total_completions: number };
    expect(body.streak).toBe(3);
    expect(body.total_completions).toBe(4);
  });

  it('完了履歴が無ければstreakは0', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = insertTestTask(db, userId, listId, 'タスク');
    const sessionId = insertSession(db, userId);

    const app = setupApp();
    const res = await app.request(`/api/v1/tasks/${taskId}/streak`, {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { streak: number };
    expect(body.streak).toBe(0);
  });

  it('他ユーザーのタスクはnot_found', async () => {
    db = createTestDb();
    const userId = uuidv7();
    const otherUserId = uuidv7();
    insertTestUser(db, userId);
    insertTestUser(db, otherUserId);
    const listId = insertTestList(db, otherUserId);
    const taskId = insertTestTask(db, otherUserId, listId, '他人のタスク');
    const sessionId = insertSession(db, userId);

    const app = setupApp();
    const res = await app.request(`/api/v1/tasks/${taskId}/streak`, {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });
});
