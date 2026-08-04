import type { Table } from 'dexie';
import { uuidv7, type SyncOp, type SyncableTable, type UserSettingsRow } from '@nestio/shared';
import { db } from './schema.js';
import { appendToOutbox } from './outbox.js';
import { nowWithSkew, pushLoop } from '../sync/engine.js';
import { logClientEvent } from '../sync/log-buffer.js';
import { pushUndo } from '../state/undoManager.js';

type Row = Record<string, unknown>;
type NonUserSettingsTable = Exclude<SyncableTable, 'user_settings'>;
interface MutationOptions {
  /** undo/redoの巻き戻し処理自身から呼ぶ時はtrue（自分自身をundoスタックに積まないようにする） */
  skipUndo?: boolean;
}

const TABLE_MAP: Record<NonUserSettingsTable, Table<Row, string>> = {
  folders: db.folders as unknown as Table<Row, string>,
  lists: db.lists as unknown as Table<Row, string>,
  tasks: db.tasks as unknown as Table<Row, string>,
  tags: db.tags as unknown as Table<Row, string>,
  task_tags: db.task_tags as unknown as Table<Row, string>,
  notes: db.notes as unknown as Table<Row, string>,
  attachments: db.attachments as unknown as Table<Row, string>,
  triggers: db.triggers as unknown as Table<Row, string>,
};

/** docs/schema.sql のDEFAULT値をローカルの新規行にも反映する */
const NEW_ROW_DEFAULTS: Record<NonUserSettingsTable, Row> = {
  folders: {},
  lists: { folder_id: null, color: '#888888', sort_mode: 'custom' },
  tasks: {
    parent_id: null,
    note: '',
    priority: 0,
    due_at: null,
    due_date: null,
    rrule: null,
    completed_at: null,
  },
  tags: { color: '#888888' },
  task_tags: {},
  notes: { title: '', body: '', color: '#FFF7C0', pinned: 0 },
  attachments: { width: null, height: null },
  triggers: { condition_json: '{}', params_json: '{}', enabled: 1 },
};

/** IndexedDBへ即時反映（楽観的更新）しつつ、outboxに積んでサーバーへの送信を予約する */
export async function upsertLocal(
  userId: string,
  table: NonUserSettingsTable,
  id: string,
  fields: Row,
  options: MutationOptions = {},
): Promise<SyncOp> {
  const updatedAt = nowWithSkew();
  const dexieTable = TABLE_MAP[table];
  const existing = await dexieTable.get(id);
  const isNew = !existing;

  const row: Row = existing
    ? { ...existing, ...fields, updated_at: updatedAt }
    : {
        ...NEW_ROW_DEFAULTS[table],
        ...fields,
        id,
        user_id: userId,
        created_at: updatedAt,
        updated_at: updatedAt,
        deleted_at: null,
        // サーバー採番前の暫定値。pullで正式なseqに上書きされる
        seq: 0,
      };

  await dexieTable.put(row);

  const op: SyncOp = { op_id: uuidv7(), table, id, op: 'upsert', updated_at: updatedAt, fields };
  await appendToOutbox(op);

  if (!options.skipUndo) {
    if (isNew) {
      // undoは論理削除、redoはその復元（deleted_atをnullに戻す）で対称にする。
      // upsertLocalで再作成しようとするとdeleted_atが残ったままになってしまうため
      pushUndo({
        undo: () => commitAndSync(deleteLocal(table, id, { skipUndo: true })),
        redo: () => commitAndSync(restoreLocal(table, id, { skipUndo: true })),
      });
    } else {
      const previousFields: Row = {};
      for (const key of Object.keys(fields)) {
        previousFields[key] = (existing as Row)[key];
      }
      pushUndo({
        undo: () => commitAndSync(upsertLocal(userId, table, id, previousFields, { skipUndo: true })),
        redo: () => commitAndSync(upsertLocal(userId, table, id, fields, { skipUndo: true })),
      });
    }
  }

  return op;
}

export async function deleteLocal(
  table: NonUserSettingsTable,
  id: string,
  options: MutationOptions = {},
): Promise<SyncOp | null> {
  const dexieTable = TABLE_MAP[table];
  const existing = await dexieTable.get(id);
  if (!existing) return null;

  const updatedAt = nowWithSkew();
  await dexieTable.put({ ...existing, deleted_at: updatedAt, updated_at: updatedAt });

  const op: SyncOp = { op_id: uuidv7(), table, id, op: 'delete', updated_at: updatedAt, fields: {} };
  await appendToOutbox(op);

  if (!options.skipUndo) {
    pushUndo({
      undo: () => commitAndSync(restoreLocal(table, id, { skipUndo: true })),
      redo: () => commitAndSync(deleteLocal(table, id, { skipUndo: true })),
    });
  }

  return op;
}

/** ゴミ箱からの復元（deleted_atをnullへ戻す）。deleteLocalと対称の操作 */
export async function restoreLocal(
  table: NonUserSettingsTable,
  id: string,
  options: MutationOptions = {},
): Promise<SyncOp | null> {
  const dexieTable = TABLE_MAP[table];
  const existing = await dexieTable.get(id);
  if (!existing) return null;

  const updatedAt = nowWithSkew();
  await dexieTable.put({ ...existing, deleted_at: null, updated_at: updatedAt });

  const op: SyncOp = { op_id: uuidv7(), table, id, op: 'restore', updated_at: updatedAt, fields: {} };
  await appendToOutbox(op);

  if (!options.skipUndo) {
    pushUndo({
      undo: () => commitAndSync(deleteLocal(table, id, { skipUndo: true })),
      redo: () => commitAndSync(restoreLocal(table, id, { skipUndo: true })),
    });
  }

  return op;
}

/** user_settings は id を持たず PK が user_id 自体（apps/api/src/sync/apply.ts と対になる特殊ケース） */
export async function upsertUserSettingsLocal(userId: string, fields: Row): Promise<SyncOp> {
  const updatedAt = nowWithSkew();
  const existing = await db.user_settings.get(userId);
  const row: UserSettingsRow = existing
    ? ({ ...existing, ...fields, updated_at: updatedAt } as UserSettingsRow)
    : ({ user_id: userId, theme: 'light', keymap_json: '{}', ...fields, updated_at: updatedAt, seq: 0 } as UserSettingsRow);

  await db.user_settings.put(row);

  const op: SyncOp = {
    op_id: uuidv7(),
    table: 'user_settings',
    id: userId,
    op: 'upsert',
    updated_at: updatedAt,
    fields,
  };
  await appendToOutbox(op);
  return op;
}

/** ローカル反映後、結果を待たずバックグラウンドでpushLoopを起動する（fire-and-forget） */
export function commitAndSync(promise: Promise<SyncOp | null>): void {
  promise
    .then(() => {
      pushLoop().catch((err) => logClientEvent('warn', 'push_trigger_failed', { error: String(err) }));
    })
    .catch((err) => console.error(err));
}
