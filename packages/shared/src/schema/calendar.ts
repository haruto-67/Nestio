import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';

export const calendarFeedRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  token: z.string().min(1),
  list_id: idSchema.nullable(),
  /** どのカレンダーアプリに登録したURLか分かるようにするユーザー任意入力の名前（改修15回目） */
  name: z.string(),
  created_at: epochMsSchema,
  revoked_at: epochMsSchema.nullable(),
});
export type CalendarFeedRow = z.infer<typeof calendarFeedRowSchema>;

export const calendarFeedCreateRequestSchema = z.object({
  list_id: idSchema.optional(),
  name: z.string().max(200).optional(),
});
export type CalendarFeedCreateRequest = z.infer<typeof calendarFeedCreateRequestSchema>;
