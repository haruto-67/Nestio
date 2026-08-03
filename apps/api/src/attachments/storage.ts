import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

/** 保存先：ATTACHMENT_DIR/<sha256の先頭2文字>/<sha256>（1ディレクトリに詰め込みすぎないための2階層分割） */
export function attachmentFilePath(baseDir: string, sha256: string): string {
  return path.join(baseDir, sha256.slice(0, 2), sha256);
}

export function attachmentExists(baseDir: string, sha256: string): boolean {
  return fs.existsSync(attachmentFilePath(baseDir, sha256));
}

export function saveAttachmentFile(baseDir: string, sha256: string, data: Buffer): void {
  const filePath = attachmentFilePath(baseDir, sha256);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

export function computeSha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** ユーザーの添付レコードのbytes合計。content-addressedによる重複排除の効果は考慮しない簡易な見積り */
export function getUserAttachmentUsageBytes(db: Database.Database, userId: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(bytes), 0) as total FROM attachments WHERE user_id = ? AND deleted_at IS NULL')
    .get(userId) as { total: number };
  return row.total;
}

/** そのユーザーがこのsha256を参照するattachmentsレコードを持っているか（他人の添付をURL推測で見せないため） */
export function userOwnsAttachment(db: Database.Database, userId: string, sha256: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM attachments WHERE user_id = ? AND sha256 = ? AND deleted_at IS NULL LIMIT 1')
    .get(userId, sha256);
  return row !== undefined;
}
