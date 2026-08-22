import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { issueUploadToken, verifyUploadToken, markUploadTokenConsumed } from './upload-tokens.js';

describe('アップロードトークンの発行・検証（改修17回目）', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('発行したトークンで検証に成功する', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);

    const { token, expiresAt } = issueUploadToken(db, userId, 'task', 'task-1', 'a.png', 'sha'.repeat(21) + 's');
    expect(expiresAt).toBeGreaterThan(Date.now());

    const result = verifyUploadToken(db, token);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.token).toEqual({
      userId,
      ownerType: 'task',
      ownerId: 'task-1',
      filename: 'a.png',
      sha256: 'sha'.repeat(21) + 's',
    });
  });

  it('存在しないトークンはnot_foundになる', () => {
    db = createTestDb();
    const result = verifyUploadToken(db, 'not-a-real-token');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('期限切れのトークンはexpiredになる', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { token } = issueUploadToken(db, userId, 'task', 'task-1', 'a.png', 'x'.repeat(64));

    // 発行直後のexpires_atを過去へ書き換えて期限切れを再現する
    db.prepare('UPDATE attachment_upload_tokens SET expires_at = ?').run(Date.now() - 1000);

    expect(verifyUploadToken(db, token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('markUploadTokenConsumedで確定消費した後は、同じトークンの検証はusedになる', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { token } = issueUploadToken(db, userId, 'note', 'note-1', 'a.png', 'x'.repeat(64));

    const result = verifyUploadToken(db, token);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    markUploadTokenConsumed(db, result.tokenId);

    expect(verifyUploadToken(db, token)).toEqual({ ok: false, reason: 'used' });
  });

  // 改修17回目フォローアップ3：sha256不一致等でバイト列検証に失敗しても、確定消費
  // （markUploadTokenConsumed）を呼ばなければ同じトークンで再試行できることの確認
  it('確定消費しなければ、同じトークンで複数回検証できる（バイト列検証失敗からのリトライを想定）', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { token } = issueUploadToken(db, userId, 'task', 'task-1', 'a.png', 'x'.repeat(64));

    expect(verifyUploadToken(db, token).ok).toBe(true);
    expect(verifyUploadToken(db, token).ok).toBe(true);
    expect(verifyUploadToken(db, token).ok).toBe(true);
  });

  it('確定消費しないまま検証を繰り返すと、上限（3回）を超えた時点でattempts_exceededになる', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { token } = issueUploadToken(db, userId, 'task', 'task-1', 'a.png', 'x'.repeat(64));

    expect(verifyUploadToken(db, token).ok).toBe(true);
    expect(verifyUploadToken(db, token).ok).toBe(true);
    expect(verifyUploadToken(db, token).ok).toBe(true);
    expect(verifyUploadToken(db, token)).toEqual({ ok: false, reason: 'attempts_exceeded' });
  });
});
