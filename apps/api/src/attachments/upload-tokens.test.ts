import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { issueUploadToken, consumeUploadToken } from './upload-tokens.js';

describe('アップロードトークンの発行・検証（改修17回目）', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('発行したトークンで1回だけ検証に成功する', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);

    const { token, expiresAt } = issueUploadToken(db, userId, 'task', 'task-1', 'a.png', 'sha'.repeat(21) + 's');
    expect(expiresAt).toBeGreaterThan(Date.now());

    const verified = consumeUploadToken(db, token);
    expect(verified).toEqual({
      userId,
      ownerType: 'task',
      ownerId: 'task-1',
      filename: 'a.png',
      sha256: 'sha'.repeat(21) + 's',
    });
  });

  it('同じトークンを2回使うと2回目はnullになる（使い切り）', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { token } = issueUploadToken(db, userId, 'note', 'note-1', 'a.png', 'x'.repeat(64));

    expect(consumeUploadToken(db, token)).not.toBeNull();
    expect(consumeUploadToken(db, token)).toBeNull();
  });

  it('存在しないトークンはnullになる', () => {
    db = createTestDb();
    expect(consumeUploadToken(db, 'not-a-real-token')).toBeNull();
  });

  it('期限切れのトークンはnullになる', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { token } = issueUploadToken(db, userId, 'task', 'task-1', 'a.png', 'x'.repeat(64));

    // 発行直後のexpires_atを過去へ書き換えて期限切れを再現する
    db.prepare('UPDATE attachment_upload_tokens SET expires_at = ?').run(Date.now() - 1000);

    expect(consumeUploadToken(db, token)).toBeNull();
  });
});
