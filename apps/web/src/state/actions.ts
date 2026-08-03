import { uuidv7 } from '@nestio/shared';
import type {
  FolderWritableFields,
  ListWritableFields,
  TaskWritableFields,
  TagWritableFields,
  TaskTagWritableFields,
  UserSettingsWritableFields,
  NoteWritableFields,
  AttachmentWritableFields,
  TaskRow,
} from '@nestio/shared';
import { upsertLocal, deleteLocal, upsertUserSettingsLocal, commitAndSync } from '../db/local-mutations.js';
import { computeNextOccurrence } from '../lib/recurrence.js';
import { savePendingAttachmentBlob } from '../db/attachment-blobs.js';
import type { ProcessedImage } from '../lib/image-processing.js';

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

export function upsertNote(userId: string, id: string, fields: NoteWritableFields): void {
  commitAndSync(upsertLocal(userId, 'notes', id, fields));
}
export function deleteNote(id: string): void {
  commitAndSync(deleteLocal('notes', id));
}

export function upsertAttachment(userId: string, id: string, fields: AttachmentWritableFields): void {
  commitAndSync(upsertLocal(userId, 'attachments', id, fields));
}
export function deleteAttachment(id: string): void {
  commitAndSync(deleteLocal('attachments', id));
}

/**
 * Blobを保留ストアに保存してから添付メタデータのopをoutboxに積む。
 * 実際のアップロードは sync/engine.ts の pushLoop が「実体→メタデータ」の順を保証して行う
 * （順序が逆になるとメタデータだけあって実体がない状態が発生するため。sync-protocol.md 9章）。
 */
export async function createAttachment(
  userId: string,
  ownerType: 'task' | 'note',
  ownerId: string,
  processed: ProcessedImage,
  filename: string,
): Promise<void> {
  await savePendingAttachmentBlob(processed.sha256, processed.blob);
  const id = uuidv7();
  upsertAttachment(userId, id, {
    owner_type: ownerType,
    owner_id: ownerId,
    sha256: processed.sha256,
    filename,
    mime: processed.blob.type,
    bytes: processed.blob.size,
    width: processed.width,
    height: processed.height,
  });
}

export { uuidv7 };
