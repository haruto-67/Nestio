import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors.js';
import { getSessionIdFromRequest, findValidSession } from '../auth/session.js';
import type { AppVariables } from './request-context.js';

/** セッションCookieを検証し、userId をコンテキストにセットする。無効なら401 */
export const requireAuth = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const db = c.get('db');
  const sessionId = getSessionIdFromRequest(c);

  if (!sessionId) {
    throw new ApiError('unauthenticated', 'セッションが見つかりません');
  }

  const session = findValidSession(db, sessionId);
  if (!session) {
    throw new ApiError('unauthenticated', 'セッションが無効です');
  }

  c.set('userId', session.user_id);
  await next();
});
