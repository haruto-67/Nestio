import type {
  FolderWritableFields,
  ListWritableFields,
  TaskWritableFields,
  TagWritableFields,
  TaskTagWritableFields,
  UserSettingsWritableFields,
  TaskRow,
} from '@nestio/shared';
import { upsertLocal, deleteLocal, upsertUserSettingsLocal, commitAndSync } from '../db/local-mutations.js';
import { computeNextOccurrence } from '../lib/recurrence.js';

export function upsertFolder(userId: string, id: string, fields: FolderWritableFields): void {
  commitAndSync(upsertLocal(userId, 'folders', id, fields));
}
export function deleteFolder(id: string): void {
  commitAndSync(deleteLocal('folders', id));
}

export function upsertList(userId: string, id: string, fields: ListWritableFields): void {
  commitAndSync(upsertLocal(userId, 'lists', id, fields));
}
export function deleteList(id: string): void {
  commitAndSync(deleteLocal('lists', id));
}

export function upsertTask(userId: string, id: string, fields: TaskWritableFields): void {
  commitAndSync(upsertLocal(userId, 'tasks', id, fields));
}
export function deleteTask(id: string): void {
  commitAndSync(deleteLocal('tasks', id));
}

/**
 * 繰り返しタスクを完了させた場合は「完了扱い」にせず、次のoccurrenceへ進める
 * （要件定義3.1：遅れて完了しても次回期限は元の予定日基準、サボった分は溜めない）。
 * 繰り返しでない、または未完了に戻す操作は通常のcompleted_at更新のまま。
 */
export function completeTask(userId: string, task: TaskRow, completing: boolean): void {
  if (completing && task.rrule) {
    const next = computeNextOccurrence(task.rrule, task.due_date !== null);
    if (next) {
      upsertTask(userId, task.id, { due_at: next.dueAt, due_date: next.dueDate, completed_at: null });
      return;
    }
  }
  upsertTask(userId, task.id, { completed_at: completing ? Date.now() : null });
}

export function upsertTag(userId: string, id: string, fields: TagWritableFields): void {
  commitAndSync(upsertLocal(userId, 'tags', id, fields));
}
export function deleteTag(id: string): void {
  commitAndSync(deleteLocal('tags', id));
}

export function upsertTaskTag(userId: string, id: string, fields: TaskTagWritableFields): void {
  commitAndSync(upsertLocal(userId, 'task_tags', id, fields));
}
export function deleteTaskTag(id: string): void {
  commitAndSync(deleteLocal('task_tags', id));
}

export function upsertUserSettings(userId: string, fields: UserSettingsWritableFields): void {
  commitAndSync(upsertUserSettingsLocal(userId, fields));
}

export { uuidv7 } from '@nestio/shared';
