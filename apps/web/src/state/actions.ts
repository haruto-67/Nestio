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
  TriggerWritableFields,
  TaskRow,
} from '@nestio/shared';
import { upsertLocal, deleteLocal, restoreLocal, upsertUserSettingsLocal, commitAndSync } from '../db/local-mutations.js';
import { computeNextOccurrence } from '../lib/recurrence.js';
import { savePendingAttachmentBlob } from '../db/attachment-blobs.js';
import { processThumbnail, type ProcessedImage } from '../lib/image-processing.js';
import { db } from '../db/schema.js';

/** サムネイル行を本体行と区別するためのfilenameの接頭辞（改修5回目。schema変更を避けるための規約） */
export const THUMBNAIL_FILENAME_PREFIX = '__thumb__';

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
export function restoreTask(id: string): void {
  commitAndSync(restoreLocal('tasks', id));
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

/** 今回の1回だけスキップする（完了扱いにはせず、次のoccurrenceへ進めるだけ） */
export function skipTaskOccurrence(userId: string, task: TaskRow): void {
  if (!task.rrule) return;
  const next = computeNextOccurrence(task.rrule, task.due_date !== null);
  if (next) {
    upsertTask(userId, task.id, { due_at: next.dueAt, due_date: next.dueDate });
  }
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

/**
 * task_tags(task_id, tag_id)は論理削除を無視した一意制約（docs/schema.sql）を持つため、
 * 以前付けて外したタグを再度付ける時、新しいidでupsertLocalすると同じ(task_id, tag_id)の
 * 行が重複しサーバー側のUNIQUE制約違反でsyncが失敗する。既存の（論理削除済みも含む）行を
 * 探し、あればrestoreLocalで復元し、無ければ新規作成する（改修21回目）
 */
export async function attachTaskTag(userId: string, taskId: string, tagId: string): Promise<void> {
  const existing = await db.task_tags.filter((tt) => tt.task_id === taskId && tt.tag_id === tagId).first();
  if (existing) {
    if (existing.deleted_at !== null) commitAndSync(restoreLocal('task_tags', existing.id));
    return;
  }
  commitAndSync(upsertLocal(userId, 'task_tags', uuidv7(), { task_id: taskId, tag_id: tagId }));
}

export function upsertUserSettings(userId: string, fields: UserSettingsWritableFields): void {
  commitAndSync(upsertUserSettingsLocal(userId, fields));
}

export function upsertTrigger(userId: string, id: string, fields: TriggerWritableFields): void {
  commitAndSync(upsertLocal(userId, 'triggers', id, fields));
}
export function deleteTrigger(id: string): void {
  commitAndSync(deleteLocal('triggers', id));
}

export function upsertNote(userId: string, id: string, fields: NoteWritableFields): void {
  commitAndSync(upsertLocal(userId, 'notes', id, fields));
}
export function deleteNote(id: string): void {
  commitAndSync(deleteLocal('notes', id));
}
export function restoreNote(id: string): void {
  commitAndSync(restoreLocal('notes', id));
}

export function upsertAttachment(userId: string, id: string, fields: AttachmentWritableFields): void {
  commitAndSync(upsertLocal(userId, 'attachments', id, fields));
}

/** 本体を削除する時は、対になっているサムネイル行（あれば）も一緒に削除する */
export async function deleteAttachment(id: string): Promise<void> {
  const row = await db.attachments.get(id);
  commitAndSync(deleteLocal('attachments', id));
  if (!row || row.filename.startsWith(THUMBNAIL_FILENAME_PREFIX)) return;

  const pairedFilename = THUMBNAIL_FILENAME_PREFIX + row.filename;
  const siblings = await db.attachments
    .filter(
      (a) =>
        a.owner_type === row.owner_type &&
        a.owner_id === row.owner_id &&
        a.filename === pairedFilename &&
        a.deleted_at === null,
    )
    .toArray();
  for (const thumb of siblings) {
    commitAndSync(deleteLocal('attachments', thumb.id));
  }
}

/**
 * Blobを保留ストアに保存してから添付メタデータのopをoutboxに積む。
 * 実際のアップロードは sync/engine.ts の pushLoop が「実体→メタデータ」の順を保証して行う
 * （順序が逆になるとメタデータだけあって実体がない状態が発生するため。sync-protocol.md 9章）。
 * 一覧のサムネイル表示を軽くするため、本体（長辺1600px）とは別に長辺320pxの縮小版も
 * 生成してペアで保存する（改修5回目）。filenameの`__thumb__`接頭辞で本体と区別する
 * （docs/schema.sqlへのカラム追加を避けるための規約。AttachmentList側でこの接頭辞は非表示にする）
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

  try {
    const thumb = await processThumbnail(processed.blob);
    await savePendingAttachmentBlob(thumb.sha256, thumb.blob);
    upsertAttachment(userId, uuidv7(), {
      owner_type: ownerType,
      owner_id: ownerId,
      sha256: thumb.sha256,
      filename: THUMBNAIL_FILENAME_PREFIX + filename,
      mime: thumb.blob.type,
      bytes: thumb.blob.size,
      width: thumb.width,
      height: thumb.height,
    });
  } catch (err) {
    // サムネイル生成に失敗しても本体の添付自体は成功させる（フォールバックは本体画像を使う）
    console.error('thumbnail generation failed', err);
  }
}

export { uuidv7 };
