import type { ZodTypeAny } from 'zod';
import {
  folderWritableFields,
  listWritableFields,
  taskWritableFields,
  tagWritableFields,
  taskTagWritableFields,
  noteWritableFields,
  attachmentWritableFields,
  triggerWritableFields,
} from '@nestio/shared';

/**
 * /sync/push で汎用UPSERT/DELETEを扱えるテーブルのメタデータ。
 * user_settings は id を持たず PK が user_id 自体で構造が異なるため対象外
 * （Phase 1 でキーマップ同期を実装した際に専用ロジックを追加済み。apply.ts参照）。
 */
export const SYNC_TABLES = {
  folders: {
    columns: ['name', 'sort_order'],
    requiredOnInsert: ['name', 'sort_order'],
    writableSchema: folderWritableFields,
  },
  lists: {
    columns: ['folder_id', 'name', 'color', 'sort_mode', 'sort_order'],
    requiredOnInsert: ['name', 'sort_order'],
    writableSchema: listWritableFields,
  },
  tasks: {
    columns: [
      'list_id',
      'parent_id',
      'title',
      'note',
      'priority',
      'due_at',
      'due_date',
      'rrule',
      'completed_at',
      'sort_order',
      'blocked_by_task_id',
    ],
    requiredOnInsert: ['list_id', 'title', 'sort_order'],
    writableSchema: taskWritableFields,
  },
  tags: {
    columns: ['name', 'color'],
    requiredOnInsert: ['name'],
    writableSchema: tagWritableFields,
  },
  task_tags: {
    columns: ['task_id', 'tag_id'],
    requiredOnInsert: ['task_id', 'tag_id'],
    writableSchema: taskTagWritableFields,
  },
  notes: {
    columns: ['title', 'body', 'color', 'pinned', 'sort_order'],
    requiredOnInsert: ['sort_order'],
    writableSchema: noteWritableFields,
  },
  attachments: {
    columns: ['owner_type', 'owner_id', 'sha256', 'filename', 'mime', 'bytes', 'width', 'height'],
    requiredOnInsert: ['owner_type', 'owner_id', 'sha256', 'filename', 'mime', 'bytes'],
    writableSchema: attachmentWritableFields,
  },
  triggers: {
    columns: ['name', 'event', 'condition_json', 'action_key', 'params_json', 'enabled'],
    requiredOnInsert: ['name', 'event', 'action_key'],
    writableSchema: triggerWritableFields,
  },
} as const satisfies Record<
  string,
  { columns: readonly string[]; requiredOnInsert: readonly string[]; writableSchema: ZodTypeAny }
>;

export type ImplementedSyncTable = keyof typeof SYNC_TABLES;

export function isImplementedSyncTable(table: string): table is ImplementedSyncTable {
  return Object.prototype.hasOwnProperty.call(SYNC_TABLES, table);
}
