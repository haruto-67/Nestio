import type Database from 'better-sqlite3';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { purgeOldTombstones, purgeOldAppliedOps } from './tombstones.js';
import { purgeOrphanedAttachmentFiles } from './attachments.js';
import { purgeOldTriggerRuns } from './trigger-runs.js';

const GC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** tombstone・applied_ops・孤児添付ファイル・Hatch実行ログを削除する（sync-protocol.md 6章、cron/日次） */
export function runGc(db: Database.Database, env: Env, logger: Logger): void {
  const { deletedRows: deletedTombstones } = purgeOldTombstones(db, env.TOMBSTONE_RETENTION_DAYS);
  const { deletedRows: deletedAppliedOps } = purgeOldAppliedOps(db, env.TOMBSTONE_RETENTION_DAYS);
  const { deletedFiles } = purgeOrphanedAttachmentFiles(db, env.ATTACHMENT_DIR);
  const { deletedRows: deletedTriggerRuns } = purgeOldTriggerRuns(db, env.TOMBSTONE_RETENTION_DAYS);

  logger.info(
    { scope: 'gc', deletedTombstones, deletedAppliedOps, deletedFiles, deletedTriggerRuns },
    'gc_completed',
  );
}

/** 起動時に1回実行し、以後24時間ごとに実行する */
export function startGcWorker(db: Database.Database, env: Env, logger: Logger): () => void {
  const tick = () => {
    try {
      runGc(db, env, logger);
    } catch (err) {
      logger.error({ err }, 'gc_worker_tick_failed');
    }
  };

  tick();
  const timer = setInterval(tick, GC_INTERVAL_MS);
  return () => clearInterval(timer);
}
