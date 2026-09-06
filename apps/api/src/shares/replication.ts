import type Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { bumpSeq } from '../sync/seq.js';

type TableName = 'tasks' | 'lists' | 'folders';

/** 指定したfolderIdをacceptedで共有されている全editorのuser_id一覧を返す */
export function folderShareEditorIds(db: Database.Database, folderId: string): string[] {
  const rows = db
    .prepare(
      `SELECT invited_user_id FROM folder_shares
       WHERE folder_id = ? AND status = 'accepted' AND deleted_at IS NULL`,
    )
    .all(folderId) as { invited_user_id: string }[];
  return rows.map((r) => r.invited_user_id);
}

/**
 * 指定したlistIdをacceptedで共有されている全editorのuser_id一覧を返す。
 * リストを直接共有している場合に加え、そのリストの所属フォルダが共有されている場合も含める
 * （改修22回目フォローアップ：フォルダ共有。以後そのフォルダに追加/移動されたリストも
 * 自動的に共有対象になる「動的共有」を実現する部分）
 */
export function listShareEditorIds(db: Database.Database, listId: string): string[] {
  const direct = db
    .prepare(
      `SELECT invited_user_id FROM list_shares
       WHERE list_id = ? AND status = 'accepted' AND deleted_at IS NULL`,
    )
    .all(listId) as { invited_user_id: string }[];

  const list = db.prepare('SELECT folder_id FROM lists WHERE id = ?').get(listId) as
    | { folder_id: string | null }
    | undefined;
  const viaFolder = list?.folder_id ? folderShareEditorIds(db, list.folder_id) : [];

  return [...new Set([...direct.map((r) => r.invited_user_id), ...viaFolder])];
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
  table: 'tasks' | 'lists',
  rowId: string,
): string[] {
  const editorIds = listShareEditorIds(db, listId);
  replicateRowsToEditors(db, editorIds, [{ table, rowId }]);
  return editorIds;
}

/** folders行が変化した後に呼ぶ。replicateToSharedEditorsのfolders版 */
export function replicateFolderToSharedEditors(db: Database.Database, folderId: string): string[] {
  const editorIds = folderShareEditorIds(db, folderId);
  replicateRowsToEditors(db, editorIds, [{ table: 'folders', rowId: folderId }]);
  return editorIds;
}

function replicateRowsToEditors(
  db: Database.Database,
  editorIds: string[],
  rows: { table: TableName; rowId: string }[],
): void {
  if (editorIds.length === 0 || rows.length === 0) return;
  const insert = db.prepare(
    'INSERT INTO shared_row_changes (id, user_id, table_name, row_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const now = Date.now();
  for (const editorId of editorIds) {
    for (const { table, rowId } of rows) {
      const seq = bumpSeq(db, editorId);
      insert.run(uuidv7(), editorId, table, rowId, seq, now);
    }
  }
}

/**
 * リストが（新規作成／フォルダ間移動で）別のフォルダに属することになった際、そのリストの
 * 既存タスク全件を、新しい所属先で共有されている全editorへ複製する（改修22回目フォローアップ：
 * フォルダ共有後にリストをそのフォルダへ移動しても、既存タスクがすぐ見えるようにするため）
 */
export function replicateAllTasksInList(db: Database.Database, listId: string): void {
  const editorIds = listShareEditorIds(db, listId);
  if (editorIds.length === 0) return;
  const taskIds = db.prepare('SELECT id FROM tasks WHERE list_id = ?').all(listId) as { id: string }[];
  replicateRowsToEditors(
    db,
    editorIds,
    taskIds.map(({ id }) => ({ table: 'tasks' as const, rowId: id })),
  );
}

/**
 * リスト共有の招待が承諾された瞬間、招待前から存在する既存タスクとリスト自体も
 * 新しいeditorへ複製する（改修22回目：招待後に作られたタスクしか見えないと使い物にならないため）
 */
export function replicateExistingListToNewEditor(db: Database.Database, listId: string, editorId: string): void {
  const taskIds = db.prepare('SELECT id FROM tasks WHERE list_id = ?').all(listId) as { id: string }[];
  replicateRowsToEditors(db, [editorId], [
    { table: 'lists', rowId: listId },
    ...taskIds.map(({ id }) => ({ table: 'tasks' as const, rowId: id })),
  ]);
}

/**
 * フォルダ共有の招待が承諾された瞬間、そのフォルダ自体・配下の全リスト・各リストの全タスクを
 * 新しいeditorへ複製する（改修22回目フォローアップ）
 */
export function replicateExistingFolderToNewEditor(db: Database.Database, folderId: string, editorId: string): void {
  const listIds = db.prepare('SELECT id FROM lists WHERE folder_id = ?').all(folderId) as { id: string }[];
  const rows: { table: TableName; rowId: string }[] = [{ table: 'folders', rowId: folderId }];
  for (const { id: listId } of listIds) {
    rows.push({ table: 'lists', rowId: listId });
    const taskIds = db.prepare('SELECT id FROM tasks WHERE list_id = ?').all(listId) as { id: string }[];
    for (const { id: taskId } of taskIds) rows.push({ table: 'tasks', rowId: taskId });
  }
  replicateRowsToEditors(db, [editorId], rows);
}
