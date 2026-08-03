import type Database from 'better-sqlite3';
import { SYNC_TABLES } from '../sync/tables.js';
import { raiseGcBoundarySeq } from '../sync/seq.js';

const SYNCABLE_TABLES_WITH_TOMBSTONE = Object.keys(SYNC_TABLES) as (keyof typeof SYNC_TABLES)[];

/**
 * 30日以上前に論理削除された行を物理削除する（sync-protocol.md 6章）。
 * 削除前に、そのユーザーの最大seqを sync_state.gc_boundary_seq に記録しておくことで、
 * それより古い since で pull してきたクライアントに full_resync_required を返せるようにする
 * （tombstoneを取りこぼしたまま「差分なし」と誤認させないため）。
 */
export function purgeOldTombstones(db: Database.Database, retentionDays: number): { deletedRows: number } {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deletedRows = 0;

  const run = db.transaction(() => {
    for (const table of SYNCABLE_TABLES_WITH_TOMBSTONE) {
      const boundaries = db
        .prepare(`SELECT user_id, MAX(seq) as max_seq FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ? GROUP BY user_id`)
        .all(cutoff) as { user_id: string; max_seq: number }[];

      for (const { user_id, max_seq } of boundaries) {
        raiseGcBoundarySeq(db, user_id, max_seq);
      }

      const result = db.prepare(`DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`).run(cutoff);
      deletedRows += result.changes;
    }
  });
  run();

  return { deletedRows };
}

export function purgeOldAppliedOps(db: Database.Database, retentionDays: number): { deletedRows: number } {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM applied_ops WHERE applied_at < ?').run(cutoff);
  return { deletedRows: result.changes };
}
