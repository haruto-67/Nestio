import { z } from 'zod';
import { idSchema, epochMsSchema, dateOnlySchema, seqSchema, sortOrderSchema, colorSchema } from './common.js';

const syncable = {
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
  deleted_at: epochMsSchema.nullable(),
  seq: seqSchema,
};

export const folderRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  name: z.string().min(1),
  sort_order: sortOrderSchema,
  ...syncable,
});
export type FolderRow = z.infer<typeof folderRowSchema>;

/** /sync/push の fields に載せられるキー。id・user_id・seq等の管理フィールドは除く */
export const folderWritableFields = folderRowSchema
  .omit({ id: true, user_id: true, created_at: true, updated_at: true, deleted_at: true, seq: true })
  .partial();
export type FolderWritableFields = z.infer<typeof folderWritableFields>;

export const listSortModeSchema = z.enum(['custom', 'due', 'priority', 'name']);
export type ListSortMode = z.infer<typeof listSortModeSchema>;

export const listRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  folder_id: idSchema.nullable(),
  name: z.string().min(1),
  color: colorSchema,
  sort_mode: listSortModeSchema,
  sort_order: sortOrderSchema,
  ...syncable,
});
export type ListRow = z.infer<typeof listRowSchema>;

export const listWritableFields = listRowSchema
  .omit({ id: true, user_id: true, created_at: true, updated_at: true, deleted_at: true, seq: true })
  .partial();
export type ListWritableFields = z.infer<typeof listWritableFields>;

/** 0=なし 1=低 2=中 3=高 */
export const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type Priority = z.infer<typeof prioritySchema>;

export const taskRowSchema = z
  .object({
    id: idSchema,
    user_id: idSchema,
    list_id: idSchema,
    parent_id: idSchema.nullable(),
    title: z.string().min(1),
    note: z.string(),
    priority: prioritySchema,
    due_at: epochMsSchema.nullable(),
    due_date: dateOnlySchema.nullable(),
    rrule: z.string().nullable(),
    completed_at: epochMsSchema.nullable(),
    sort_order: sortOrderSchema,
    ...syncable,
  })
  .refine((row) => row.due_at === null || row.due_date === null, {
    message: 'due_at と due_date は同時に指定できません',
    path: ['due_date'],
  });
export type TaskRow = z.infer<typeof taskRowSchema>;

const taskWritableShape = {
  list_id: idSchema,
  parent_id: idSchema.nullable(),
  title: z.string().min(1),
  note: z.string(),
  priority: prioritySchema,
  due_at: epochMsSchema.nullable(),
  due_date: dateOnlySchema.nullable(),
  rrule: z.string().nullable(),
  completed_at: epochMsSchema.nullable(),
  sort_order: sortOrderSchema,
};
export const taskWritableFields = z.object(taskWritableShape).partial();
export type TaskWritableFields = z.infer<typeof taskWritableFields>;

export const tagRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  name: z.string().min(1),
  color: colorSchema,
  ...syncable,
});
export type TagRow = z.infer<typeof tagRowSchema>;

export const tagWritableFields = tagRowSchema
  .omit({ id: true, user_id: true, created_at: true, updated_at: true, deleted_at: true, seq: true })
  .partial();
export type TagWritableFields = z.infer<typeof tagWritableFields>;

export const taskTagRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  task_id: idSchema,
  tag_id: idSchema,
  ...syncable,
});
export type TaskTagRow = z.infer<typeof taskTagRowSchema>;

export const taskTagWritableFields = z.object({ task_id: idSchema, tag_id: idSchema }).partial();
export type TaskTagWritableFields = z.infer<typeof taskTagWritableFields>;
