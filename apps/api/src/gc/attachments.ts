import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

/**
 * 参照ゼロになった添付ファイルの実体を削除する（sync-protocol.md 6章）。
 * 「参照ゼロになってから30日」は、tombstoneを30日保持してから物理削除する既存の仕組み
 * （purgeOldTombstones）と組み合わせることで自然に満たされる：
 * このGCワーカーは常に purgeOldTombstones の直後に呼ぶため、行が完全に消えるまでは
 * ファイルも残り続け、行が消えた時点で初めて（＝deleted_atから30日後に）ファイルを削除する。
 * 参照は deleted_at を問わず数える（tombstone保持期間中はまだ「参照あり」として扱う）。
 */
export function purgeOrphanedAttachmentFiles(db: Database.Database, attachmentDir: string): { deletedFiles: number } {
  if (!fs.existsSync(attachmentDir)) return { deletedFiles: 0 };

  const hasReference = db.prepare('SELECT 1 FROM attachments WHERE sha256 = ? LIMIT 1');
  let deletedFiles = 0;

  for (const shard of fs.readdirSync(attachmentDir)) {
    const shardPath = path.join(attachmentDir, shard);
    if (!fs.statSync(shardPath).isDirectory()) continue;

    for (const sha256 of fs.readdirSync(shardPath)) {
      const referenced = hasReference.get(sha256);
      if (referenced) continue;
      fs.unlinkSync(path.join(shardPath, sha256));
      deletedFiles++;
    }
  }

  return { deletedFiles };
}
