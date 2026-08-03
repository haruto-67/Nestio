import { createMiddleware } from 'hono/factory';
import { ApiError } from '../errors.js';
import type { AppVariables } from './request-context.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 固定ウィンドウ（1分）のシンプルなレート制限。1ユーザー運用のため in-memory で十分
 * （複数プロセス構成にするなら共有ストアへの置き換えが必要になる）。
 */
function createLimiter() {
  const buckets = new Map<string, Bucket>();

  return function checkLimit(key: string, limitPerMinute: number): boolean {
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    bucket.count += 1;
    return bucket.count <= limitPerMinute;
  };
}

/** 認証済みなら userId、未認証なら送信元IPをキーにする */
function rateLimitKey(c: { get(key: 'userId'): string | undefined; req: { header(name: string): string | undefined } }): string {
  const userId = c.get('userId');
  if (userId) return `user:${userId}`;
  const forwardedFor = c.req.header('x-forwarded-for');
  return `ip:${forwardedFor ?? 'unknown'}`;
}

export function rateLimit(limitPerMinute: number) {
  const checkLimit = createLimiter();

  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const key = rateLimitKey(c);
    if (!checkLimit(key, limitPerMinute)) {
      throw new ApiError('rate_limited', 'リクエストが多すぎます。しばらく待って再度お試しください');
    }
    await next();
  });
}
