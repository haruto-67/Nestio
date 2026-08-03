import type { ZodTypeAny } from 'zod';
import {
  folderWritableFields,
  listWritableFields,
  taskWritableFields,
  tagWritableFields,
  taskTagWritableFields,
} from '@nestio/shared';

/**
 * /sync/push で汎用UPSERT/DELETEを扱えるテーブルのメタデータ。
 * user_settings は id を持たず PK が user_id 自体で構造が異なるため対象外
 * （Phase 4 でキーマップ同期を実装する際に専用ロジックを追加する）。
 * notes / attachments / triggers は Phase 4/5 でここに追加する。
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
} as const satisfies Record<
  string,
  { columns: readonly string[]; requiredOnInsert: readonly string[]; writableSchema: ZodTypeAny }
>;

export type ImplementedSyncTable = keyof typeof SYNC_TABLES;

export function isImplementedSyncTable(table: string): table is ImplementedSyncTable {
  return Object.prototype.hasOwnProperty.call(SYNC_TABLES, table);
}
