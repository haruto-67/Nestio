import type {
  FolderWritableFields,
  ListWritableFields,
  TaskWritableFields,
  TagWritableFields,
  TaskTagWritableFields,
  UserSettingsWritableFields,
} from '@nestio/shared';
import { upsertLocal, deleteLocal, upsertUserSettingsLocal, commitAndSync } from '../db/local-mutations.js';

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
