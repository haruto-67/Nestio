import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';

describe('本番ビルドの静的配信（WEB_DIST_DIR）', () => {
  let db: Database.Database;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-web-dist-test-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>nestio-index</body></html>');
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("app")');
  });

  afterEach(() => {
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function setupApp(webDistDir: string) {
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      WEB_DIST_DIR: webDistDir,
    } as unknown as NodeJS.ProcessEnv);
    db = new Database(':memory:');
    const logger = createLogger(env);
    return createApp(env, db, logger);
  }

  it('WEB_DIST_DIRが未設定なら静的配信しない（未知パスは404）', async () => {
    const app = setupApp('');
    const res = await app.request('/');
    expect(res.status).toBe(404);
  });

  it('静的アセットを配信する', async () => {
    const app = setupApp(dir);
    const res = await app.request('/assets/app.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('console.log');
  });

  it('未知のパスはSPAのindex.htmlにフォールバックする', async () => {
    const app = setupApp(dir);
    const res = await app.request('/some/client/route');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nestio-index');
  });

  it('/api/v1/* は静的配信より優先される', async () => {
    const app = setupApp(dir);
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('存在しない/api/v1/*パスはSPAのindex.htmlにフォールバックせず404になる', async () => {
    const app = setupApp(dir);
    const res = await app.request('/api/v1/nonexistent-endpoint');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('nestio-index');
  });
});
