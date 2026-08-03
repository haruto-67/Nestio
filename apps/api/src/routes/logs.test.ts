import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
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

describe('logs routes', () => {
  let db: Database.Database;
  let logDir: string;

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-logs-route-test-'));
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  function setupApp() {
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', LOG_DIR: logDir } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);
    return createApp(env, db, logger);
  }

  it('GET /logs/recent は直近ログを新しい順で返す', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    fs.writeFileSync(
      path.join(logDir, 'nestio.2026-08-04.1.log'),
      [
        JSON.stringify({ level: 30, time: 't', msg: 'first' }),
        JSON.stringify({ level: 50, time: 't', msg: 'second' }),
      ].join('\n') + '\n',
    );
    const app = setupApp();

    const res = await app.request('/api/v1/logs/recent', { headers: { Cookie: `nestio_session=${sessionId}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { msg: string }[];
    expect(body.map((e) => e.msg)).toEqual(['second', 'first']);
  });

  it('level=errorでフィルタできる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    fs.writeFileSync(
      path.join(logDir, 'nestio.2026-08-04.1.log'),
      [
        JSON.stringify({ level: 30, time: 't', msg: 'info' }),
        JSON.stringify({ level: 50, time: 't', msg: 'error' }),
      ].join('\n') + '\n',
    );
    const app = setupApp();

    const res = await app.request('/api/v1/logs/recent?level=error', {
      headers: { Cookie: `nestio_session=${sessionId}` },
    });
    const body = (await res.json()) as { msg: string }[];
    expect(body.map((e) => e.msg)).toEqual(['error']);
  });

  it('未認証だと401', async () => {
    db = createTestDb();
    const app = setupApp();
    const res = await app.request('/api/v1/logs/recent');
    expect(res.status).toBe(401);
  });
});
