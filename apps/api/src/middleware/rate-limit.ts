import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { ApiError } from '../errors.js';
import { sendPushToUser } from '../push/sender.js';
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

// レート制限超過の異常検知アラート（改修5回目・改修4回目ブレインストーム案E）。
// 個別ルートのbucketはルートごとに独立しているため、「短時間に繰り返しレート制限に
// 引っかかっている」ことの検知は全ルート共通のこのMapで行う。1ユーザー運用のため、
// 検知したら「唯一のユーザー」宛にpush通知する（アカウント乗っ取り試行の早期検知）
const ALERT_THRESHOLD = 10;
const ALERT_WINDOW_MS = 15 * 60_000;
const ALERT_COOLDOWN_MS = 60 * 60_000;
interface RejectionTracker {
  count: number;
  windowStart: number;
  lastAlertAt: number;
}
const rejectionTrackers = new Map<string, RejectionTracker>();

function trackRejectionAndMaybeAlert(c: Context<{ Variables: AppVariables }>, key: string): void {
  const now = Date.now();
  let tracker = rejectionTrackers.get(key);
  if (!tracker || now - tracker.windowStart > ALERT_WINDOW_MS) {
    tracker = { count: 0, windowStart: now, lastAlertAt: 0 };
  }
  tracker.count += 1;
  rejectionTrackers.set(key, tracker);

  if (tracker.count < ALERT_THRESHOLD || now - tracker.lastAlertAt < ALERT_COOLDOWN_MS) return;
  tracker.lastAlertAt = now;

  const db = c.get('db');
  const env = c.get('env');
  const logger = c.get('logger');
  const user = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
  if (!user) return;

  sendPushToUser(db, env, logger, user.id, {
    title: 'Nestio: 異常なアクセスを検知しました',
    body: `${key} から15分以内に${tracker.count}回のレート制限超過がありました。心当たりが無ければパスワード等の見直しを検討してください`,
  }).catch((err) => logger.warn({ error: String(err) }, 'rate_limit_alert_push_failed'));
}

export function rateLimit(limitPerMinute: number) {
  const checkLimit = createLimiter();

  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const key = rateLimitKey(c);
    if (!checkLimit(key, limitPerMinute)) {
      trackRejectionAndMaybeAlert(c, key);
      throw new ApiError('rate_limited', 'リクエストが多すぎます。しばらく待って再度お試しください');
    }
    await next();
  });
}
