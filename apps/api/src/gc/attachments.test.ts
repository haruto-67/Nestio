import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { attachmentFilePath, saveAttachmentFile } from '../attachments/storage.js';
import { purgeOrphanedAttachmentFiles } from './attachments.js';

function insertAttachment(
  db: Database.Database,
  userId: string,
  sha256: string,
  deletedAt: number | null,
): void {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO attachments (id, user_id, owner_type, owner_id, sha256, filename, mime, bytes, width, height, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, 'task', ?, ?, 'f.webp', 'image/webp', 10, NULL, NULL, ?, ?, ?, 1)`,
  ).run(id, userId, uuidv7(), sha256, Date.now(), Date.now(), deletedAt);
}

describe('purgeOrphanedAttachmentFiles', () => {
  let db: Database.Database;
  let userId: string;
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-gc-attach-test-'));
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('参照が無いファイルは削除する', () => {
    const sha256 = 'a'.repeat(64);
    saveAttachmentFile(dir, sha256, Buffer.from('data'));

    const { deletedFiles } = purgeOrphanedAttachmentFiles(db, dir);

    expect(deletedFiles).toBe(1);
    expect(fs.existsSync(attachmentFilePath(dir, sha256))).toBe(false);
  });

  it('活きているattachments行が参照するファイルは削除しない', () => {
    const sha256 = 'b'.repeat(64);
    saveAttachmentFile(dir, sha256, Buffer.from('data'));
    insertAttachment(db, userId, sha256, null);

    const { deletedFiles } = purgeOrphanedAttachmentFiles(db, dir);

    expect(deletedFiles).toBe(0);
    expect(fs.existsSync(attachmentFilePath(dir, sha256))).toBe(true);
  });

  it('保持期間内のtombstone（未物理削除）が参照するファイルも削除しない', () => {
    const sha256 = 'c'.repeat(64);
    saveAttachmentFile(dir, sha256, Buffer.from('data'));
    insertAttachment(db, userId, sha256, Date.now() - 1000); // 論理削除済みだがまだ行は残っている

    const { deletedFiles } = purgeOrphanedAttachmentFiles(db, dir);

    expect(deletedFiles).toBe(0);
    expect(fs.existsSync(attachmentFilePath(dir, sha256))).toBe(true);
  });

  it('ディレクトリが存在しなくてもエラーにならない', () => {
    const missingDir = path.join(dir, 'does-not-exist');
    expect(() => purgeOrphanedAttachmentFiles(db, missingDir)).not.toThrow();
  });
});
