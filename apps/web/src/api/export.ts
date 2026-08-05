import { apiClient } from './client.js';
import { upsertLocal, commitAndSync } from '../db/local-mutations.js';
import type { SyncableTable } from '@nestio/shared';

interface ExportPayload {
  exported_at: number;
  format_version: number;
  tables: Record<string, Record<string, unknown>[]>;
}

/** 全データをJSONとしてダウンロードする（改修5回目） */
export async function exportAllData(): Promise<void> {
  const payload = await apiClient.get<ExportPayload>('/export');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nestio-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * インポート対象テーブルと書き込み可能フィールド（apps/api/src/sync/tables.ts のcolumnsと対応）。
 * 添付ファイルの実体（画像バイナリ）はエクスポートに含まれないため、attachmentsは対象外。
 * 依存関係の順（フォルダ→リスト→タグ→タスク→タスクタグ→メモ→トリガー）で取り込む
 */
const IMPORT_TABLES: { table: SyncableTable; fields: readonly string[] }[] = [
  { table: 'folders', fields: ['name', 'sort_order'] },
  { table: 'lists', fields: ['folder_id', 'name', 'color', 'sort_mode', 'sort_order'] },
  { table: 'tags', fields: ['name', 'color'] },
  {
    table: 'tasks',
    fields: [
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
  },
  { table: 'task_tags', fields: ['task_id', 'tag_id'] },
  { table: 'notes', fields: ['title', 'body', 'color', 'pinned', 'sort_order'] },
  { table: 'triggers', fields: ['name', 'event', 'condition_json', 'action_key', 'params_json', 'enabled'] },
];

/**
 * エクスポートしたJSONファイルを取り込む。同じIDのまま復元するため、同一アカウントへの
 * 再取り込みは冪等（LWWにより既存行が新しければ上書きされない）。件数を返す
 */
export async function importAllData(userId: string, file: File): Promise<number> {
  const text = await file.text();
  const payload = JSON.parse(text) as ExportPayload;
  let count = 0;

  for (const { table, fields } of IMPORT_TABLES) {
    const rows = payload.tables?.[table] ?? [];
    for (const row of rows) {
      const id = row.id as string | undefined;
      if (!id) continue;
      const writable: Record<string, unknown> = {};
      for (const f of fields) {
        if (f in row) writable[f] = row[f];
      }
      commitAndSync(upsertLocal(userId, table as Exclude<SyncableTable, 'user_settings'>, id, writable));
      count += 1;
    }
  }

  return count;
}
