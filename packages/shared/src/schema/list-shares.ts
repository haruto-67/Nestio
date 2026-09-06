import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';

/**
 * 「共有リスト」機能（改修22回目）。詳細な設計はdocs/sync-protocol.md 10章を参照。
 * list_sharesは/sync/pushの対象外（招待・承諾・解除は専用CRUD APIで完結する）
 */
export const listShareStatusSchema = z.enum(['pending', 'accepted']);
export type ListShareStatus = z.infer<typeof listShareStatusSchema>;

export const listShareRowSchema = z.object({
  id: idSchema,
  list_id: idSchema,
  owner_user_id: idSchema,
  invited_user_id: idSchema,
  invited_email: z.string(),
  status: listShareStatusSchema,
  created_at: epochMsSchema,
  accepted_at: epochMsSchema.nullable(),
});
export type ListShareRow = z.infer<typeof listShareRowSchema>;

export const listShareCreateRequestSchema = z.object({
  list_id: idSchema,
  invited_email: z.string().email(),
});
export type ListShareCreateRequest = z.infer<typeof listShareCreateRequestSchema>;
