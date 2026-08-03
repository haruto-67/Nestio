import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';

export const oauthClientRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  name: z.string().min(1),
  /** JSON配列文字列 */
  redirect_uris: z.string(),
  created_at: epochMsSchema,
});
export type OauthClientRow = z.infer<typeof oauthClientRowSchema>;

export const oauthScopeSchema = z.enum(['read', 'write']);
export type OauthScope = z.infer<typeof oauthScopeSchema>;

export const oauthTokenRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  client_id: idSchema,
  token_hash: z.string().min(1),
  /** スペース区切りの "read" / "write" */
  scope: z.string(),
  expires_at: epochMsSchema,
  revoked_at: epochMsSchema.nullable(),
  created_at: epochMsSchema,
});
export type OauthTokenRow = z.infer<typeof oauthTokenRowSchema>;

export const dynamicClientRegistrationRequestSchema = z.object({
  client_name: z.string().min(1),
  redirect_uris: z.array(z.string().url()).min(1),
});
export type DynamicClientRegistrationRequest = z.infer<typeof dynamicClientRegistrationRequestSchema>;
