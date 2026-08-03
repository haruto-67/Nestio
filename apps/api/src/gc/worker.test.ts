import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList } from '../test-utils/db.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { runGc } from './worker.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('runGc', () => {
  let db: Database.Database;
  // ATTACHMENT_DIRを必ずテスト専用の一時ディレクトリに向ける。
  // 上書きし忘れるとデフォルト値（本番の実添付ディレクトリ）を走査し、
  // 空のテストDBを基準に「参照なし」と誤判定して実ファイルを削除してしまう。
  let attachmentDir: string;

  beforeEach(() => {
    attachmentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-gc-worker-test-'));
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(attachmentDir, { recursive: true, force: true });
  });

  it('例外を投げずに完了する（tombstone・applied_ops・添付が空でも）', () => {
    db = createTestDb();
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', ATTACHMENT_DIR: attachmentDir } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    expect(() => runGc(db, env, logger)).not.toThrow();
  });

  it('古いtombstoneと期限切れapplied_opsをまとめて削除する', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);

    const taskId = uuidv7();
    db.prepare(
      `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, ?, NULL, 't', '', 0, NULL, NULL, NULL, NULL, 1, ?, ?, ?, 1)`,
    ).run(taskId, userId, listId, Date.now(), Date.now(), Date.now() - 40 * DAY_MS);

    db.prepare('INSERT INTO applied_ops (op_id, user_id, applied_at, result_seq) VALUES (?, ?, ?, 1)').run(
      uuidv7(),
      userId,
      Date.now() - 40 * DAY_MS,
    );

    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      ATTACHMENT_DIR: attachmentDir,
      TOMBSTONE_RETENTION_DAYS: '30',
    } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);

    runGc(db, env, logger);

    expect(db.prepare('SELECT COUNT(*) as c FROM tasks').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM applied_ops').get()).toEqual({ c: 0 });
  });
});
