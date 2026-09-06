import type Database from 'better-sqlite3';
import { syncableTableSchema, type SyncPullResponse } from '@nestio/shared';
import { isImplementedSyncTable } from './tables.js';
import { getLastSeq, getGcBoundarySeq } from './seq.js';

const ALL_TABLES = syncableTableSchema.options;
// リスト/フォルダ共有（改修22回目・改修22回目フォローアップ）：この3テーブルだけ、
// 自分がownerの行に加えてshared_row_changes経由で複製された行もマージして返す
// （docs/sync-protocol.md 10章）
const SHAREABLE_TABLES = new Set(['tasks', 'lists', 'folders']);

/**
 * 各テーブルごとに `seq > since` を limit 件まで取得する（sync-protocol.md 3章）。
 * いずれかのテーブルでちょうど limit 件取れた場合は取りこぼしの可能性があるため has_more=true とし、
 * next_seq には今回取得できた最大 seq を返す。
 */
export function pullChanges(
  db: Database.Database,
  userId: string,
  since: number,
  limit: number,
): SyncPullResponse {
  if (since > 0 && since < getGcBoundarySeq(db, userId)) {
    return { changes: {}, next_seq: since, has_more: false, full_resync_required: true };
  }

  const changes: Record<string, Row[]> = {};
  let maxSeq = since;
  let hasMore = false;

  for (const table of ALL_TABLES) {
    if (table === 'user_settings') {
      // PKがuser_id自体で1ユーザー1行のため、他テーブルと違いLIMITは意味を持たない
      const row = db.prepare('SELECT * FROM user_settings WHERE user_id = ? AND seq > ?').get(userId, since) as
        | Row
        | undefined;
      changes[table] = row ? [row] : [];
      if (row) maxSeq = Math.max(maxSeq, row.seq as number);
      continue;
    }

    if (!isImplementedSyncTable(table)) {
      // Phase 4/5 で SYNC_TABLES に追加するまでは常に空配列を返す
      changes[table] = [];
      continue;
    }

    const rows = SHAREABLE_TABLES.has(table)
      ? pullShareableTable(db, table, userId, since, limit)
      : (db
          .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`)
          .all(userId, since, limit) as Row[]);

    changes[table] = rows;

    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1] as Row;
      maxSeq = Math.max(maxSeq, lastRow.seq as number);
    }
    if (rows.length === limit) {
      hasMore = true;
    }
  }

  const nextSeq = hasMore ? maxSeq : getLastSeq(db, userId);

  return { changes, next_seq: nextSeq, has_more: hasMore };
}

/**
 * tasks/listsは「自分がownerの行」に加え、shared_row_changes経由で自分（editor）に
 * 複製された行もマージしてseq昇順に返す。返す行のseqは、複製分だけ
 * shared_row_changes.seq（＝自分自身の視点のseq）に差し替える（docs/sync-protocol.md 10章）。
 * 同じ行が複数回複製されて重複しても、クライアントは冪等にUPSERTするだけなので実害はない
 */
function pullShareableTable(
  db: Database.Database,
  table: string,
  userId: string,
  since: number,
  limit: number,
): Row[] {
  const ownRows = db
    .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`)
    .all(userId, since, limit) as Row[];

  const sharedRows = db
    .prepare(
      `SELECT t.*, s.seq AS seq FROM shared_row_changes s
       JOIN ${table} t ON t.id = s.row_id
       WHERE s.user_id = ? AND s.table_name = ? AND s.seq > ?
       ORDER BY s.seq LIMIT ?`,
    )
    .all(userId, table, since, limit) as Row[];

  return [...ownRows, ...sharedRows].sort((a, b) => (a.seq as number) - (b.seq as number)).slice(0, limit);
}

type Row = Record<string, unknown>;
