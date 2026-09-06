import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';
import { listShareStatusSchema } from './list-shares.js';

/**
 * 「フォルダ共有」機能（改修22回目フォローアップ）。list_sharesと対称の設計。
 * フォルダを共有すると、以後そのフォルダに追加/移動されたリストも自動的に共有対象になる
 * （docs/sync-protocol.md 10章）
 */
export const folderShareRowSchema = z.object({
  id: idSchema,
  folder_id: idSchema,
  owner_user_id: idSchema,
  invited_user_id: idSchema,
  invited_email: z.string(),
  status: listShareStatusSchema,
  created_at: epochMsSchema,
  accepted_at: epochMsSchema.nullable(),
});
export type FolderShareRow = z.infer<typeof folderShareRowSchema>;

export const folderShareCreateRequestSchema = z.object({
  folder_id: idSchema,
  invited_email: z.string().email(),
});
export type FolderShareCreateRequest = z.infer<typeof folderShareCreateRequestSchema>;

/** 受け取った招待の一覧表示用。list-shares.tsのincomingListShareViewSchemaと対称 */
export const incomingFolderShareViewSchema = folderShareRowSchema.extend({
  folder_name: z.string(),
  owner_email: z.string(),
});
export type IncomingFolderShareView = z.infer<typeof incomingFolderShareViewSchema>;
