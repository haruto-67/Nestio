import type Database from 'better-sqlite3';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { sendPushToUser } from './sender.js';

const POLL_INTERVAL_MS = 30_000;

interface ScheduledPushRow {
  id: string;
  user_id: string;
  title: string;
  body: string;
}

/** 30秒ごとに fire_at <= now AND sent_at IS NULL を拾って送信する（api-spec.md 6章） */
export function startPushWorker(db: Database.Database, env: Env, logger: Logger): () => void {
  const timer = setInterval(() => {
    processPendingPushes(db, env, logger).catch((err) => logger.error({ err }, 'push_worker_tick_failed'));
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}

export async function processPendingPushes(db: Database.Database, env: Env, logger: Logger): Promise<void> {
  const now = Date.now();
  const due = db
    .prepare(
      `SELECT id, user_id, title, body FROM scheduled_pushes
       WHERE fire_at <= ? AND sent_at IS NULL AND canceled_at IS NULL
       ORDER BY fire_at`,
    )
    .all(now) as ScheduledPushRow[];

  const markSent = db.prepare('UPDATE scheduled_pushes SET sent_at = ? WHERE id = ?');

  for (const item of due) {
    await sendPushToUser(db, env, logger, item.user_id, { title: item.title, body: item.body });
    markSent.run(Date.now(), item.id);
  }
}
