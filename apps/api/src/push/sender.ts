import webpush from 'web-push';
import type Database from 'better-sqlite3';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';

let configured = false;

function ensureConfigured(env: Env): boolean {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return true;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * ユーザーの全購読へ送信する。404/410（購読が期限切れ・取り消し済み）が返ったものは
 * 「期限切れの購読を貯めない」ため削除する（api-spec.md 6章）。
 */
export async function sendPushToUser(
  db: Database.Database,
  env: Env,
  logger: Logger,
  userId: string,
  payload: { title: string; body: string },
): Promise<void> {
  if (!ensureConfigured(env)) {
    logger.warn({ user_id: userId }, 'push_not_configured');
    return;
  }

  const subs = db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId) as PushSubscriptionRow[];

  const deleteStmt = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          deleteStmt.run(sub.id);
          logger.info({ subscription_id: sub.id, status: statusCode }, 'push_subscription_removed');
        } else {
          logger.error({ err, subscription_id: sub.id }, 'push_send_failed');
        }
      }
    }),
  );
}
