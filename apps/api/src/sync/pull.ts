import type Database from 'better-sqlite3';
import { syncableTableSchema, type SyncPullResponse } from '@nestio/shared';
import { isImplementedSyncTable } from './tables.js';
import { getLastSeq } from './seq.js';

const ALL_TABLES = syncableTableSchema.options;

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
  const changes: Record<string, Row[]> = {};
  let maxSeq = since;
  let hasMore = false;

  for (const table of ALL_TABLES) {
    if (!isImplementedSyncTable(table)) {
      // Phase 4/5 で SYNC_TABLES に追加するまでは常に空配列を返す
      changes[table] = [];
      continue;
    }

    const rows = db
      .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?`)
      .all(userId, since, limit) as Row[];

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

type Row = Record<string, unknown>;
