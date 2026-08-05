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

const ENCRYPTION_ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
// 平文ファイルと区別するための先頭マジックバイト（改修5回目より前に保存された既存の添付は
// このマジックが無く平文のまま残る。ENCRYPTION_KEY設定後に読む際もこれで自動判別する）
const ENCRYPTED_MAGIC = Buffer.from('NSE1');

function deriveKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('ATTACHMENT_ENCRYPTION_KEYは32バイト（base64エンコード）である必要があります');
  }
  return key;
}

/**
 * 添付ファイルの保存時暗号化（改修5回目・改修4回目ブレインストーム案A「添付ファイルの暗号化保存」）。
 * `ATTACHMENT_ENCRYPTION_KEY`が未設定なら従来通り平文で保存する（開発環境や、既存運用からの
 * 無停止移行を優先するデフォルト挙動）。ハッシュ計算・マジックバイト検証は平文に対して行われるため
 * （apps/api/src/routes/attachments.ts）、暗号化はディスクI/Oの直前・直後だけで完結する。
 * 鍵を後から設定した場合、それより前に保存済みの平文ファイルは暗号化されないまま残る
 * （マジックバイトで自動判別して読めるため実害は無いが、ディスク上では非暗号化のままという点に注意）。
 */
export function saveAttachmentFile(baseDir: string, sha256: string, data: Buffer, encryptionKey?: string): void {
  const filePath = attachmentFilePath(baseDir, sha256);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!encryptionKey) {
    fs.writeFileSync(filePath, data);
    return;
  }

  const key = deriveKey(encryptionKey);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  fs.writeFileSync(filePath, Buffer.concat([ENCRYPTED_MAGIC, iv, authTag, ciphertext]));
}

/** 復号して平文を返す。マジックバイトが無ければ（鍵未設定時代の既存ファイル）そのまま返す */
export function readAttachmentFile(baseDir: string, sha256: string, encryptionKey?: string): Buffer {
  const raw = fs.readFileSync(attachmentFilePath(baseDir, sha256));
  const isEncrypted = raw.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC);
  if (!isEncrypted) return raw;
  if (!encryptionKey) {
    throw new Error('このファイルは暗号化されていますが、ATTACHMENT_ENCRYPTION_KEYが設定されていません');
  }

  const key = deriveKey(encryptionKey);
  let offset = ENCRYPTED_MAGIC.length;
  const iv = raw.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const authTag = raw.subarray(offset, offset + AUTH_TAG_BYTES);
  offset += AUTH_TAG_BYTES;
  const ciphertext = raw.subarray(offset);

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
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
