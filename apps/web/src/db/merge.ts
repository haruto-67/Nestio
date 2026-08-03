import {
  folderRowSchema,
  listRowSchema,
  taskRowSchema,
  tagRowSchema,
  taskTagRowSchema,
  noteRowSchema,
  attachmentRowSchema,
  triggerRowSchema,
  userSettingsRowSchema,
  type SyncPullResponse,
} from '@nestio/shared';
import { db } from './schema.js';

/**
 * pullレスポンスをIndexedDBへ反映する。削除は行が消えるのではなく
 * deleted_at付きの行として届く（tombstone）ため、そのままputする
 * （読み取り側で deleted_at を見て除外する）。
 */
export async function applyPullResponse(response: SyncPullResponse): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.folders,
      db.lists,
      db.tasks,
      db.tags,
      db.task_tags,
      db.notes,
      db.attachments,
      db.triggers,
      db.user_settings,
    ],
    async () => {
      const folders = (response.changes.folders ?? []).map((r) => folderRowSchema.parse(r));
      if (folders.length) await db.folders.bulkPut(folders);

      const lists = (response.changes.lists ?? []).map((r) => listRowSchema.parse(r));
      if (lists.length) await db.lists.bulkPut(lists);

      const tasks = (response.changes.tasks ?? []).map((r) => taskRowSchema.parse(r));
      if (tasks.length) await db.tasks.bulkPut(tasks);

      const tags = (response.changes.tags ?? []).map((r) => tagRowSchema.parse(r));
      if (tags.length) await db.tags.bulkPut(tags);

      const taskTags = (response.changes.task_tags ?? []).map((r) => taskTagRowSchema.parse(r));
      if (taskTags.length) await db.task_tags.bulkPut(taskTags);

      const notes = (response.changes.notes ?? []).map((r) => noteRowSchema.parse(r));
      if (notes.length) await db.notes.bulkPut(notes);

      const attachments = (response.changes.attachments ?? []).map((r) => attachmentRowSchema.parse(r));
      if (attachments.length) await db.attachments.bulkPut(attachments);

      const triggers = (response.changes.triggers ?? []).map((r) => triggerRowSchema.parse(r));
      if (triggers.length) await db.triggers.bulkPut(triggers);

      const userSettings = (response.changes.user_settings ?? []).map((r) => userSettingsRowSchema.parse(r));
      if (userSettings.length) await db.user_settings.bulkPut(userSettings);
    },
  );
}
