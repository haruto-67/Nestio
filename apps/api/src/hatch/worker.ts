import type Database from 'better-sqlite3';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { claimNextQueuedRun, markRunSucceeded, markRunFailed } from './queue.js';
import { runHatchAction } from './action-runner.js';
import { ClaudeTimeoutError } from './claude-runner.js';
import { checkAllPeriodicTriggers } from './periodic-events.js';

const RUN_POLL_INTERVAL_MS = 5_000;
const PERIODIC_CHECK_INTERVAL_MS = 30_000;

interface TriggerRow {
  id: string;
  action_key: string;
  params_json: string;
}

export async function processOneRun(db: Database.Database, env: Env, logger: Logger): Promise<void> {
  const run = claimNextQueuedRun(db);
  if (!run) return;

  const trigger = db
    .prepare('SELECT id, action_key, params_json FROM triggers WHERE id = ? AND deleted_at IS NULL')
    .get(run.trigger_id) as TriggerRow | undefined;

  if (!trigger) {
    markRunFailed(db, run.id, run.attempt, 'trigger not found (deleted?)', false);
    return;
  }

  try {
    const output = await runHatchAction(db, env, logger, run.user_id, run.subject_id, trigger);
    markRunSucceeded(db, run.id, output);
    logger.info({ scope: 'hatch', trigger_id: trigger.id, run_id: run.id }, 'hatch_run_succeeded');
  } catch (err) {
    const isTimeout = err instanceof ClaudeTimeoutError;
    const message = err instanceof Error ? err.message : String(err);
    markRunFailed(db, run.id, run.attempt, message, isTimeout);
    logger.error({ scope: 'hatch', trigger_id: trigger.id, run_id: run.id, err }, 'hatch_run_failed');
  }
}

/**
 * 同時実行数1（`claimNextQueuedRun`がrunning中のジョブがあれば何も返さないことで保証）で
 * キューを処理し続け、並行して定期イベント（due_soon/overdue/schedule）をチェックする。
 */
export function startHatchWorker(db: Database.Database, env: Env, logger: Logger): () => void {
  let stopped = false;
  let runTimer: ReturnType<typeof setTimeout> | null = null;
  let periodicTimer: ReturnType<typeof setInterval> | null = null;

  async function runTick() {
    if (stopped) return;
    try {
      await processOneRun(db, env, logger);
    } catch (err) {
      logger.error({ err }, 'hatch_worker_tick_failed');
    }
    if (!stopped) runTimer = setTimeout(runTick, RUN_POLL_INTERVAL_MS);
  }

  runTick();

  periodicTimer = setInterval(() => {
    try {
      checkAllPeriodicTriggers(db);
    } catch (err) {
      logger.error({ err }, 'hatch_periodic_check_failed');
    }
  }, PERIODIC_CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    if (runTimer) clearTimeout(runTimer);
    if (periodicTimer) clearInterval(periodicTimer);
  };
}
