import {
  folderRowSchema,
  listRowSchema,
  taskRowSchema,
  tagRowSchema,
  taskTagRowSchema,
  userSettingsRowSchema,
  type SyncPullResponse,
} from '@nestio/shared';
import type { AppData } from './types.js';

function applyRow<T extends { id: string; deleted_at: number | null }>(map: Map<string, T>, row: T): void {
  if (row.deleted_at !== null) {
    map.delete(row.id);
  } else {
    map.set(row.id, row);
  }
}

/** pullレスポンスをAppDataへ反映する。since の更新はしない（呼び出し側でページングを制御するため） */
export function mergeChanges(data: AppData, response: SyncPullResponse): void {
  for (const raw of response.changes.folders ?? []) {
    applyRow(data.folders, folderRowSchema.parse(raw));
  }
  for (const raw of response.changes.lists ?? []) {
    applyRow(data.lists, listRowSchema.parse(raw));
  }
  for (const raw of response.changes.tasks ?? []) {
    applyRow(data.tasks, taskRowSchema.parse(raw));
  }
  for (const raw of response.changes.tags ?? []) {
    applyRow(data.tags, tagRowSchema.parse(raw));
  }
  for (const raw of response.changes.task_tags ?? []) {
    applyRow(data.taskTags, taskTagRowSchema.parse(raw));
  }
  // user_settings は1ユーザー1行・deleted_atを持たないため、他テーブルと違い単純に上書きする
  for (const raw of response.changes.user_settings ?? []) {
    data.userSettings = userSettingsRowSchema.parse(raw);
  }
}
