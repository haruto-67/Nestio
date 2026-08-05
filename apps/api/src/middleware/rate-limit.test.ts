import { describe, expect, it, afterEach } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { requestContext, type AppVariables } from './request-context.js';
import { handleError } from './error-handler.js';
import { rateLimit } from './rate-limit.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';

describe('rateLimit', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  function setupApp(limitPerMinute: number) {
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
    const logger = createLogger(env);
    const app = new Hono<{ Variables: AppVariables }>();
    app.use('*', requestContext(logger, env, db));
    app.onError(handleError);
    app.use('/limited', rateLimit(limitPerMinute));
    app.get('/limited', (c) => c.json({ ok: true }));
    return app;
  }

  it('上限を超えるとrate_limitedで拒否される', async () => {
    db = createTestDb();
    const app = setupApp(2);

    const res1 = await app.request('/limited', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    const res2 = await app.request('/limited', { headers: { 'x-forwarded-for': '1.2.3.4' } });
    const res3 = await app.request('/limited', { headers: { 'x-forwarded-for': '1.2.3.4' } });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res3.status).toBe(429);
  });

  it('異常検知の閾値に達しても（push未設定でも）リクエスト処理自体はクラッシュしない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const app = setupApp(1);

    let lastStatus = 0;
    for (let i = 0; i < 15; i++) {
      const res = await app.request('/limited', { headers: { 'x-forwarded-for': '9.9.9.9' } });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
