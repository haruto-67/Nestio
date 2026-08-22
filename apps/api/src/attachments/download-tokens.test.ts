import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { issueDownloadToken, verifyDownloadToken } from './download-tokens.js';

describe('ダウンロードトークンの発行・検証（改修19回目）', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('発行したトークンで1回だけ検証に成功する', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);

    const { token, expiresAt } = issueDownloadToken(db, userId, 'x'.repeat(64));
    expect(expiresAt).toBeGreaterThan(Date.now());

    const result = verifyDownloadToken(db, token);
    expect(result).toEqual({ ok: true, tokenId: expect.any(String), token: { userId, sha256: 'x'.repeat(64) } });
  });

  it('同じトークンを2回使うと2回目はusedになる（使い切り）', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { token } = issueDownloadToken(db, userId, 'x'.repeat(64));

    expect(verifyDownloadToken(db, token).ok).toBe(true);
    expect(verifyDownloadToken(db, token)).toEqual({ ok: false, reason: 'used' });
  });

  it('存在しないトークンはnot_foundになる', () => {
    db = createTestDb();
    expect(verifyDownloadToken(db, 'not-a-real-token')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('期限切れのトークンはexpiredになる', () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const { token } = issueDownloadToken(db, userId, 'x'.repeat(64));

    db.prepare('UPDATE attachment_download_tokens SET expires_at = ?').run(Date.now() - 1000);

    expect(verifyDownloadToken(db, token)).toEqual({ ok: false, reason: 'expired' });
  });
});
