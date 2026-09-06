import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { issueApiKey } from '../api-keys/keys.js';

function setupApp(db: Database.Database) {
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
  const logger = createLogger(env);
  return createApp(env, db, logger);
}

describe('public api routes', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('読み書きキーでタスクを作成・取得・完了・削除できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const { key } = issueApiKey(db, userId, 'テスト用', 'read write');
    const app = setupApp(db);
    const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

    const createRes = await app.request('/api/v1/public/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ list_id: listId, title: '買い物' }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { id: string; title: string };
    expect(created.title).toBe('買い物');

    const getRes = await app.request(`/api/v1/public/tasks/${created.id}`, { headers: auth });
    const got = (await getRes.json()) as { id: string; title: string };
    expect(got.title).toBe('買い物');

    const completeRes = await app.request(`/api/v1/public/tasks/${created.id}/complete`, {
      method: 'POST',
      headers: auth,
    });
    expect(completeRes.status).toBe(200);

    const deleteRes = await app.request(`/api/v1/public/tasks/${created.id}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(deleteRes.status).toBe(200);

    const listRes = await app.request(`/api/v1/public/tasks?list_id=${listId}`, { headers: auth });
    const { tasks } = (await listRes.json()) as { tasks: unknown[] };
    expect(tasks).toHaveLength(0); // 削除済みは既定で含まれない
  });

  it('read専用キーでは書き込みが403になる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const { key } = issueApiKey(db, userId, 'read専用', 'read');
    const app = setupApp(db);

    const res = await app.request('/api/v1/public/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_id: listId, title: '書けないはず' }),
    });
    expect(res.status).toBe(403);
  });

  it('read専用キーでも一覧・検索・取得は成功する', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    insertTestTask(db, userId, listId, 'サンプルタスク');
    const { key } = issueApiKey(db, userId, 'read専用', 'read');
    const app = setupApp(db);
    const auth = { Authorization: `Bearer ${key}` };

    const listRes = await app.request('/api/v1/public/tasks', { headers: auth });
    expect(listRes.status).toBe(200);
    const { tasks } = (await listRes.json()) as { tasks: { title: string }[] };
    expect(tasks.some((t) => t.title === 'サンプルタスク')).toBe(true);

    const searchRes = await app.request('/api/v1/public/tasks/search?q=サンプル', { headers: auth });
    expect(searchRes.status).toBe(200);
  });

  it('APIキーが無いと401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/public/tasks');
    expect(res.status).toBe(401);
  });

  it('無効なAPIキーは401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/public/tasks', {
      headers: { Authorization: 'Bearer nestio_sk_invalid' },
    });
    expect(res.status).toBe(401);
  });

  it('失効済みAPIキーは401', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { key, id } = issueApiKey(db, userId, '失効予定', 'read');
    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(Date.now(), id);
    const app = setupApp(db);

    const res = await app.request('/api/v1/public/tasks', { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(401);
  });

  it('存在しないタスクIDのget_taskはvalidation_failedとして400を返す', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { key } = issueApiKey(db, userId, 'テスト用', 'read');
    const app = setupApp(db);

    const res = await app.request(`/api/v1/public/tasks/${uuidv7()}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(400);
  });

  it('他ユーザーのAPIキーでは他ユーザーのタスクを取得できない', async () => {
    db = createTestDb();
    const ownerId = uuidv7();
    const otherId = uuidv7();
    insertTestUser(db, ownerId);
    insertTestUser(db, otherId);
    const listId = insertTestList(db, ownerId);
    const taskId = insertTestTask(db, ownerId, listId, 'owner専用タスク');
    const { key } = issueApiKey(db, otherId, '他人のキー', 'read');
    const app = setupApp(db);

    const res = await app.request(`/api/v1/public/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(400);
  });
});
