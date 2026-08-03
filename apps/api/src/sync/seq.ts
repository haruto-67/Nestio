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
