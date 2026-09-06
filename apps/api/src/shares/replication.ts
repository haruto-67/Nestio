import type Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { bumpSeq } from '../sync/seq.js';

type TableName = 'tasks' | 'lists';

/** 指定したlistIdをacceptedで共有されている全editorのuser_id一覧を返す */
export function listShareEditorIds(db: Database.Database, listId: string): string[] {
  const rows = db
    .prepare(
      `SELECT invited_user_id FROM list_shares
       WHERE list_id = ? AND status = 'accepted' AND deleted_at IS NULL`,
    )
    .all(listId) as { invited_user_id: string }[];
  return rows.map((r) => r.invited_user_id);
}

/** そのリストがownerId以外に共有されているかどうか */
export function isListShared(db: Database.Database, listId: string): boolean {
  return listShareEditorIds(db, listId).length > 0;
}

/**
 * tasks/listsの行が変化した後に呼ぶ。そのリストを共有されている各editor自身のseq系列を進め、
 * shared_row_changesに複製ポインタを追記する（docs/sync-protocol.md 10章）。
 * 呼び出し元のトランザクション内で呼ぶこと（bumpSeqとの整合性のため）。
 * 戻り値：実際にseqが進んだeditorのuser_id一覧（SSE通知に使う）
 */
export function replicateToSharedEditors(
  db: Database.Database,
  listId: string,
  table: TableName,
  rowId: string,
): string[] {
  const editorIds = listShareEditorIds(db, listId);
  const insert = db.prepare(
    'INSERT INTO shared_row_changes (id, user_id, table_name, row_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const now = Date.now();
  for (const editorId of editorIds) {
    const editorSeq = bumpSeq(db, editorId);
    insert.run(uuidv7(), editorId, table, rowId, editorSeq, now);
  }
  return editorIds;
}

/**
 * 招待が承諾された瞬間、招待前から存在する既存タスクとリスト自体も新しいeditorへ複製する
 * （改修22回目：招待後に作られたタスクしか見えないと使い物にならないため）
 */
export function replicateExistingListToNewEditor(db: Database.Database, listId: string, editorId: string): void {
  const now = Date.now();
  const insert = db.prepare(
    'INSERT INTO shared_row_changes (id, user_id, table_name, row_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const listSeq = bumpSeq(db, editorId);
  insert.run(uuidv7(), editorId, 'lists', listId, listSeq, now);

  const taskIds = db.prepare('SELECT id FROM tasks WHERE list_id = ?').all(listId) as { id: string }[];
  for (const { id } of taskIds) {
    const taskSeq = bumpSeq(db, editorId);
    insert.run(uuidv7(), editorId, 'tasks', id, taskSeq, now);
  }
}
