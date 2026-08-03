import { Hono } from 'hono';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { readRecentLogs } from '../logs/reader.js';

export const logsRoute = new Hono<{ Variables: AppVariables }>();

logsRoute.use('/logs/*', requireAuth);

/** 自分専用の簡易ログビューア（docs/phases.md Phase 6）。マルチユーザー化はしていないため全ログを見せてよい */
logsRoute.get('/logs/recent', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const env = c.get('env');
  const level = c.req.query('level') === 'error' ? 'error' : 'all';
  const requestId = c.req.query('request_id') || undefined;
  const limit = Math.min(Number(c.req.query('limit') ?? '200') || 200, 500);

  const entries = readRecentLogs(env.LOG_DIR, { limit, level, requestId });
  return c.json(entries);
});
