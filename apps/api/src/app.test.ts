import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';

function setupTestApp() {
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
  const db = new Database(':memory:');
  const logger = createLogger(env);
  const app = createApp(env, db, logger);
  return { app, db };
}

describe('GET /api/v1/health', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it('200 と ok ステータスを返す', async () => {
    const setup = setupTestApp();
    db = setup.db;

    const res = await setup.app.request('/api/v1/health');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; time: number };
    expect(body.status).toBe('ok');
    expect(typeof body.time).toBe('number');
  });

  it('X-Request-Id ヘッダーを付与する', async () => {
    const setup = setupTestApp();
    db = setup.db;

    const res = await setup.app.request('/api/v1/health');

    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });
});
