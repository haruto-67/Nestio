import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { DashboardResponse } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireApiKey } from '../middleware/api-key-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { canReadDashboard } from '../api-keys/keys.js';
import { getCurrentPomodoro, getDashboardToday, toJstIso } from '../dashboard/dashboard.js';
import { ApiError } from '../errors.js';

/**
 * iPad常時表示ダッシュボード向けの読み取り専用API（改修26回目、docs/api-spec.md）。
 * `Authorization: Bearer <APIキー>` で認証する。ダッシュボード専用キー（scope=dashboard）は
 * ここだけを呼べ、/public/ は呼べない。書き込み系は持たない
 */
export function createDashboardRoute(limitPerMinute: number) {
  const route = new Hono<{ Variables: AppVariables }>();

  const requireDashboardScope = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    if (!canReadDashboard(c.get('apiKeyScope') ?? '')) {
      throw new ApiError('forbidden', 'このAPIキーではダッシュボードを読めません');
    }
    await next();
  });
  // 認証の後に数えることで、バケットをAPIキー単位にする
  const limitPerKey = rateLimit(limitPerMinute, (c) => `apikey:${c.get('apiKeyId') ?? 'unknown'}`);

  for (const path of ['/dashboard', '/dashboard/*', '/pomodoro/current']) {
    route.use(path, requireApiKey, requireDashboardScope, limitPerKey);
  }

  const userIdOf = (userId: string | undefined): string => {
    if (!userId) throw new ApiError('unauthenticated', 'APIキーが必要です');
    return userId;
  };

  route.get('/dashboard', (c) => {
    const userId = userIdOf(c.get('userId'));
    const now = Date.now();
    const body: DashboardResponse = {
      generated_at: toJstIso(now),
      today: getDashboardToday(c.get('db'), userId, now),
      pomodoro: getCurrentPomodoro(c.get('db'), userId, now),
    };
    return c.json(body);
  });

  route.get('/dashboard/today', (c) => c.json(getDashboardToday(c.get('db'), userIdOf(c.get('userId')))));

  // 実行中でなければ null を返す（Swift側でOptionalとしてそのままデコードできる）
  route.get('/pomodoro/current', (c) => c.json(getCurrentPomodoro(c.get('db'), userIdOf(c.get('userId')))));

  return route;
}
