import { z } from 'zod';
import { idSchema, epochMsSchema, seqSchema, sortOrderSchema, colorSchema } from './common.js';

const syncable = {
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
  deleted_at: epochMsSchema.nullable(),
  seq: seqSchema,
};

export const noteRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  title: z.string(),
  body: z.string(),
  color: colorSchema,
  pinned: z.union([z.literal(0), z.literal(1)]),
  sort_order: sortOrderSchema,
  ...syncable,
});
export type NoteRow = z.infer<typeof noteRowSchema>;

export const noteWritableFields = noteRowSchema
  .omit({ id: true, user_id: true, created_at: true, updated_at: true, deleted_at: true, seq: true })
  .partial();
export type NoteWritableFields = z.infer<typeof noteWritableFields>;
