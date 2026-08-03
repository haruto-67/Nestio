import type Database from 'better-sqlite3';

/**
 * ユーザーの同期カーソルを1進め、その値を返す。
 * 採番と呼び出し元での行書き込みは同一トランザクション内で行うこと（sync-protocol.md 2章）。
 */
export function bumpSeq(db: Database.Database, userId: string): number {
  db.prepare('INSERT OR IGNORE INTO sync_state (user_id, last_seq) VALUES (?, 0)').run(userId);
  db.prepare('UPDATE sync_state SET last_seq = last_seq + 1 WHERE user_id = ?').run(userId);
  const row = db.prepare('SELECT last_seq FROM sync_state WHERE user_id = ?').get(userId) as {
    last_seq: number;
  };
  return row.last_seq;
}

export function getLastSeq(db: Database.Database, userId: string): number {
  const row = db.prepare('SELECT last_seq FROM sync_state WHERE user_id = ?').get(userId) as
    | { last_seq: number }
    | undefined;
  return row?.last_seq ?? 0;
}

/**
 * GCワーカーがtombstoneを物理削除した際の境界seq。
 * pull時に since がこれより古ければ取りこぼしの可能性があるため full_resync_required を返す
 * （sync-protocol.md 6章、docs/open-questions.md 項目7）。
 */
export function getGcBoundarySeq(db: Database.Database, userId: string): number {
  const row = db.prepare('SELECT gc_boundary_seq FROM sync_state WHERE user_id = ?').get(userId) as
    | { gc_boundary_seq: number }
    | undefined;
  return row?.gc_boundary_seq ?? 0;
}

/** 既存の境界seqより大きい場合のみ更新する（複数テーブルのGCから呼ばれても後退しない） */
export function raiseGcBoundarySeq(db: Database.Database, userId: string, seq: number): void {
  db.prepare('INSERT OR IGNORE INTO sync_state (user_id, last_seq) VALUES (?, 0)').run(userId);
  db.prepare('UPDATE sync_state SET gc_boundary_seq = MAX(gc_boundary_seq, ?) WHERE user_id = ?').run(seq, userId);
}
