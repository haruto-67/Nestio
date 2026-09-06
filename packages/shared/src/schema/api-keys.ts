import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';
import { oauthScopeSchema } from './oauth.js';

/**
 * 「API化」機能（改修22回目）：MCP（OAuth 2.1）とは別に、外部スクリプトやZapier等の
 * サービス連携から手軽に叩ける個人用APIキー認証。設定画面から発行・失効する。
 * key_hashは平文キーのSHA-256ハッシュで、クライアントへは返さない（一覧APIのレスポンスにも含めない）
 */
export const apiKeyRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  name: z.string().min(1),
  /** スペース区切りの "read" / "read write"（oauth_tokensと同じ形式） */
  scope: z.string(),
  last_used_at: epochMsSchema.nullable(),
  created_at: epochMsSchema,
  revoked_at: epochMsSchema.nullable(),
});
export type ApiKeyRow = z.infer<typeof apiKeyRowSchema>;

export const apiKeyCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  scope: oauthScopeSchema.default('read'),
});
export type ApiKeyCreateRequest = z.infer<typeof apiKeyCreateRequestSchema>;
