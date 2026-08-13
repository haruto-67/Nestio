import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors.js';
import { getSessionIdFromRequest, findValidSession } from '../auth/session.js';
import { findUserById } from '../auth/users.js';
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

/** requireAuthの後段で使う。ADMIN_EMAILと一致するユーザーのみ通す（改修10回目） */
export const requireAdmin = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const db = c.get('db');
  const env = c.get('env');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const user = findUserById(db, userId);
  if (!user || !env.ADMIN_EMAIL || user.email !== env.ADMIN_EMAIL) {
    throw new ApiError('forbidden', '管理者のみ利用できます');
  }

  await next();
});
