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

/**
 * 受け取った招待の一覧表示用（改修22回目フォローアップ：設定画面だと分かりにくいという
 * フィードバックを受け、リスト一覧側に「どのリストを」「誰(メールアドレス)から」共有されたか
 * 出す）。招待された側はacceptedになるまでlists行自体を持たないため、list_name/owner_emailは
 * list_sharesのJOINでサーバー側が付与して返す
 */
export const incomingListShareViewSchema = listShareRowSchema.extend({
  list_name: z.string(),
  owner_email: z.string(),
});
export type IncomingListShareView = z.infer<typeof incomingListShareViewSchema>;
