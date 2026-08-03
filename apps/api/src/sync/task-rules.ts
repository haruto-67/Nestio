import type Database from 'better-sqlite3';
import { bumpSeq } from './seq.js';

/**
 * candidateParentId を taskId の新しい親にしたとき循環参照が生じるか判定する。
 * candidateParentId 自身から祖先を辿って taskId に到達するなら循環になる。
 */
export function wouldCreateCycle(db: Database.Database, taskId: string, candidateParentId: string): boolean {
  if (candidateParentId === taskId) return true;

  const row = db
    .prepare(
      `
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM tasks WHERE id = ?
        UNION ALL
        SELECT t.id, t.parent_id
        FROM tasks t
        JOIN ancestors a ON t.id = a.parent_id
      )
      SELECT 1 FROM ancestors WHERE id = ? LIMIT 1
      `,
    )
    .get(candidateParentId, taskId);

  return row !== undefined;
}

/** 未完了・未削除の子孫が1つでもあれば true（完了させてはいけない） */
export function hasIncompleteDescendant(db: Database.Database, taskId: string): boolean {
  const row = db
    .prepare(
      `
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM tasks WHERE parent_id = ? AND deleted_at IS NULL
        UNION ALL
        SELECT t.id
        FROM tasks t
        JOIN descendants d ON t.parent_id = d.id
        WHERE t.deleted_at IS NULL
      )
      SELECT 1
      FROM descendants d
      JOIN tasks t ON t.id = d.id
      WHERE t.completed_at IS NULL AND t.deleted_at IS NULL
      LIMIT 1
      `,
    )
    .get(taskId);

  return row !== undefined;
}

/**
 * taskId が未完了になった直後に呼ぶ。祖先を辿り、完了済みのものがあれば
 * サーバー主導で未完了に戻す（sync-protocol.md 5章「親子の矛盾」の修復）。
 * 戻した行にも新しい seq を採番するので pull で他デバイスに伝わる。
 */
export function repairAncestorsCompletion(db: Database.Database, userId: string, taskId: string): void {
  let currentId: string | null = taskId;
  const uncompleteStmt = db.prepare(
    'UPDATE tasks SET completed_at = NULL, updated_at = ?, seq = ? WHERE id = ?',
  );
  const getParentStmt = db.prepare(
    'SELECT parent_id, completed_at FROM tasks WHERE id = ? AND deleted_at IS NULL',
  );

  // 直接の親から順にルートへ向かって辿る（自分自身は含めない）
  const startRow = getParentStmt.get(currentId) as { parent_id: string | null } | undefined;
  currentId = startRow?.parent_id ?? null;

  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const row = getParentStmt.get(currentId) as { parent_id: string | null; completed_at: number | null } | undefined;
    if (!row) break;

    if (row.completed_at !== null) {
      const seq = bumpSeq(db, userId);
      uncompleteStmt.run(Date.now(), seq, currentId);
    }

    currentId = row.parent_id;
  }
}
