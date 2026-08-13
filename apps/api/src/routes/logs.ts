import { Hono } from 'hono';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { readRecentLogs } from '../logs/reader.js';

export const logsRoute = new Hono<{ Variables: AppVariables }>();

// ログファイルはユーザー単位に分かれておらずサーバー全体の内容が見えるため、
// 申請制導入（改修10回目）に伴い管理者のみ閲覧可能にする
logsRoute.use('/logs/*', requireAuth, requireAdmin);

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
