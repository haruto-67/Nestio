import { z } from 'zod';
import { idSchema, epochMsSchema, seqSchema } from './common.js';

const syncable = {
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
  deleted_at: epochMsSchema.nullable(),
  seq: seqSchema,
};

export const attachmentOwnerTypeSchema = z.enum(['task', 'note']);
export type AttachmentOwnerType = z.infer<typeof attachmentOwnerTypeSchema>;

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256の16進数64桁である必要があります');

export const attachmentRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  owner_type: attachmentOwnerTypeSchema,
  owner_id: idSchema,
  sha256: sha256Schema,
  filename: z.string().min(1),
  mime: z.string().min(1),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  ...syncable,
});
export type AttachmentRow = z.infer<typeof attachmentRowSchema>;

export const attachmentWritableFields = attachmentRowSchema
  .omit({ id: true, user_id: true, created_at: true, updated_at: true, deleted_at: true, seq: true })
  .partial();
export type AttachmentWritableFields = z.infer<typeof attachmentWritableFields>;
