import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { issueApiKey, verifyApiKey, listApiKeys, revokeApiKey, hasApiKeyScope } from './keys.js';

describe('api-keys/keys', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('発行したキーで検証でき、last_used_atが更新される', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);

    const { id, key } = issueApiKey(db, userId, 'テスト', 'read write');
    expect(key).toMatch(/^nestio_sk_/);

    const verified = verifyApiKey(db, key);
    expect(verified).toEqual({ userId, scope: 'read write' });

    const row = db.prepare('SELECT last_used_at FROM api_keys WHERE id = ?').get(id) as {
      last_used_at: number | null;
    };
    expect(row.last_used_at).not.toBeNull();
  });

  it('平文キーはDBに保存されない', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { key } = issueApiKey(db, userId, 'テスト', 'read');

    const row = db.prepare('SELECT key_hash FROM api_keys').get() as { key_hash: string };
    expect(row.key_hash).not.toBe(key);
  });

  it('誤ったキーは検証に失敗する', () => {
    db = createTestDb();
    expect(verifyApiKey(db, 'nestio_sk_wrong')).toBeNull();
  });

  it('失効させたキーは検証に失敗する', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { id, key } = issueApiKey(db, userId, 'テスト', 'read');

    expect(revokeApiKey(db, userId, id)).toBe(true);
    expect(verifyApiKey(db, key)).toBeNull();
  });

  it('他ユーザーは失効させられない', () => {
    db = createTestDb();
    const userId = uuidv7();
    const otherId = uuidv7();
    insertTestUser(db, userId);
    insertTestUser(db, otherId);
    const { id } = issueApiKey(db, userId, 'テスト', 'read');

    expect(revokeApiKey(db, otherId, id)).toBe(false);
  });

  it('一覧は失効済みを含まない', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { id: keptId } = issueApiKey(db, userId, '残る方', 'read');
    const { id: revokedId } = issueApiKey(db, userId, '失効する方', 'read');
    revokeApiKey(db, userId, revokedId);

    const keys = listApiKeys(db, userId);
    expect(keys.map((k) => k.id)).toEqual([keptId]);
  });

  it('hasApiKeyScope: readキーはread専用操作のみ許可', () => {
    expect(hasApiKeyScope('read', 'read')).toBe(true);
    expect(hasApiKeyScope('read', 'write')).toBe(false);
    expect(hasApiKeyScope('read write', 'read')).toBe(true);
    expect(hasApiKeyScope('read write', 'write')).toBe(true);
  });
});
