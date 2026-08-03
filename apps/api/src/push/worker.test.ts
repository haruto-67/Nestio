import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { processPendingPushes } from './worker.js';

describe('processPendingPushes', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('VAPID未設定でも例外を投げず、送信予定をsent_atで確定させる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    db.prepare(
      `INSERT INTO scheduled_pushes (id, user_id, kind, task_id, fire_at, title, body, created_at)
       VALUES (?, ?, 'due_reminder', NULL, ?, 'title', 'body', ?)`,
    ).run(uuidv7(), userId, Date.now() - 1000, Date.now());

    await expect(processPendingPushes(db, env, logger)).resolves.not.toThrow();

    const rows = db.prepare('SELECT sent_at FROM scheduled_pushes WHERE user_id = ?').all(userId) as {
      sent_at: number | null;
    }[];
    expect(rows[0]?.sent_at).not.toBeNull();
  });

  it('fire_atが未来のものは処理しない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    db.prepare(
      `INSERT INTO scheduled_pushes (id, user_id, kind, task_id, fire_at, title, body, created_at)
       VALUES (?, ?, 'due_reminder', NULL, ?, 'title', 'body', ?)`,
    ).run(uuidv7(), userId, Date.now() + 60_000, Date.now());

    await processPendingPushes(db, env, logger);

    const rows = db.prepare('SELECT sent_at FROM scheduled_pushes WHERE user_id = ?').all(userId) as {
      sent_at: number | null;
    }[];
    expect(rows[0]?.sent_at).toBeNull();
  });

  it('canceled_atがある予約は処理しない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    db.prepare(
      `INSERT INTO scheduled_pushes (id, user_id, kind, task_id, fire_at, title, body, created_at, canceled_at)
       VALUES (?, ?, 'due_reminder', NULL, ?, 'title', 'body', ?, ?)`,
    ).run(uuidv7(), userId, Date.now() - 1000, Date.now(), Date.now());

    await processPendingPushes(db, env, logger);

    const rows = db.prepare('SELECT sent_at FROM scheduled_pushes WHERE user_id = ?').all(userId) as {
      sent_at: number | null;
    }[];
    expect(rows[0]?.sent_at).toBeNull();
  });
});
