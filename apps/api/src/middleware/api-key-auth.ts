import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors.js';
import { verifyApiKey } from '../api-keys/keys.js';
import type { AppVariables } from './request-context.js';

/**
 * 公開API（改修22回目、外部スクリプト・サービス連携向け）の認証。セッションCookieではなく
 * `Authorization: Bearer <個人用APIキー>` を検証し、userIdとscopeをコンテキストにセットする
 */
export const requireApiKey = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const db = c.get('db');
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiError('unauthenticated', 'APIキーが必要です（Authorization: Bearer <key>）');
  }

  const verified = verifyApiKey(db, authHeader.slice('Bearer '.length));
  if (!verified) throw new ApiError('unauthenticated', 'APIキーが無効です');

  c.set('userId', verified.userId);
  c.set('apiKeyId', verified.id);
  c.set('apiKeyScope', verified.scope);
  await next();
});
