import {
  uuidv7,
  type SyncOp,
  type SyncableTable,
  type FolderWritableFields,
  type ListWritableFields,
  type TaskWritableFields,
  type TagWritableFields,
  type TaskTagWritableFields,
  type UserSettingsWritableFields,
} from '@nestio/shared';

function makeOp(
  table: SyncableTable,
  id: string,
  op: 'upsert' | 'delete',
  fields: Record<string, unknown>,
): SyncOp {
  return { op_id: uuidv7(), table, id, op, updated_at: Date.now(), fields };
}

export function upsertFolderOp(id: string, fields: FolderWritableFields): SyncOp {
  return makeOp('folders', id, 'upsert', fields);
}
export function deleteFolderOp(id: string): SyncOp {
  return makeOp('folders', id, 'delete', {});
}

export function upsertListOp(id: string, fields: ListWritableFields): SyncOp {
  return makeOp('lists', id, 'upsert', fields);
}
export function deleteListOp(id: string): SyncOp {
  return makeOp('lists', id, 'delete', {});
}

export function upsertTaskOp(id: string, fields: TaskWritableFields): SyncOp {
  return makeOp('tasks', id, 'upsert', fields);
}
export function deleteTaskOp(id: string): SyncOp {
  return makeOp('tasks', id, 'delete', {});
}

export function upsertTagOp(id: string, fields: TagWritableFields): SyncOp {
  return makeOp('tags', id, 'upsert', fields);
}
export function deleteTagOp(id: string): SyncOp {
  return makeOp('tags', id, 'delete', {});
}

export function upsertTaskTagOp(id: string, fields: TaskTagWritableFields): SyncOp {
  return makeOp('task_tags', id, 'upsert', fields);
}
export function deleteTaskTagOp(id: string): SyncOp {
  return makeOp('task_tags', id, 'delete', {});
}

/** user_settings は id を持たず PK が user_id 自体のため、op.id には自分の user_id を渡す */
export function upsertUserSettingsOp(userId: string, fields: UserSettingsWritableFields): SyncOp {
  return makeOp('user_settings', userId, 'upsert', fields);
}

export { uuidv7 };
