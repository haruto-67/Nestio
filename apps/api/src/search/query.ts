import type Database from 'better-sqlite3';
import type { SearchTaskResult, SearchNoteResult } from '@nestio/shared';

/** FTS5クエリの特殊文字（", *, ^等）をユーザー入力からエスケープするため常にフレーズ検索にする */
function escapeFtsQuery(q: string): string {
  return `"${q.replace(/"/g, '""')}"`;
}

/** trigramは3文字単位で索引を作るため、2文字以下はヒットしない。LIKEにフォールバックする */
const FTS_MIN_LENGTH = 3;

export function searchTasks(db: Database.Database, userId: string, q: string, limit: number): SearchTaskResult[] {
  if (q.length < FTS_MIN_LENGTH) {
    const like = `%${q}%`;
    return db
      .prepare(
        `SELECT id, title, list_id, title as snippet
         FROM tasks
         WHERE user_id = ? AND deleted_at IS NULL AND (title LIKE ? OR note LIKE ?)
         LIMIT ?`,
      )
      .all(userId, like, like, limit) as SearchTaskResult[];
  }

  return db
    .prepare(
      `SELECT tasks.id as id, tasks.title as title, tasks.list_id as list_id,
              snippet(tasks_fts, -1, '', '', '...', 20) as snippet
       FROM tasks_fts
       JOIN tasks ON tasks.rowid = tasks_fts.rowid
       WHERE tasks_fts MATCH ? AND tasks.user_id = ? AND tasks.deleted_at IS NULL
       LIMIT ?`,
    )
    .all(escapeFtsQuery(q), userId, limit) as SearchTaskResult[];
}

export function searchNotes(db: Database.Database, userId: string, q: string, limit: number): SearchNoteResult[] {
  if (q.length < FTS_MIN_LENGTH) {
    const like = `%${q}%`;
    return db
      .prepare(
        `SELECT id, title, title as snippet
         FROM notes
         WHERE user_id = ? AND deleted_at IS NULL AND (title LIKE ? OR body LIKE ?)
         LIMIT ?`,
      )
      .all(userId, like, like, limit) as SearchNoteResult[];
  }

  return db
    .prepare(
      `SELECT notes.id as id, notes.title as title,
              snippet(notes_fts, -1, '', '', '...', 20) as snippet
       FROM notes_fts
       JOIN notes ON notes.rowid = notes_fts.rowid
       WHERE notes_fts MATCH ? AND notes.user_id = ? AND notes.deleted_at IS NULL
       LIMIT ?`,
    )
    .all(escapeFtsQuery(q), userId, limit) as SearchNoteResult[];
}
