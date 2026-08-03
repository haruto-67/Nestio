import type Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';

export interface TriggerRunRow {
  id: string;
  trigger_id: string;
  user_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout';
  subject_id: string | null;
  attempt: number;
  output: string;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
}

export function enqueueTriggerRun(
  db: Database.Database,
  userId: string,
  triggerId: string,
  subjectId: string | null,
): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO trigger_runs (id, trigger_id, user_id, status, subject_id, attempt, output, error, started_at, finished_at, created_at)
     VALUES (?, ?, ?, 'queued', ?, 0, '', NULL, NULL, NULL, ?)`,
  ).run(id, triggerId, userId, subjectId, Date.now());
  return id;
}

/** 同時実行数1のため、実行中(running)のジョブが無い場合のみ次の1件を返す */
export function claimNextQueuedRun(db: Database.Database): TriggerRunRow | null {
  const runningExists = db.prepare("SELECT 1 FROM trigger_runs WHERE status = 'running' LIMIT 1").get();
  if (runningExists) return null;

  const next = db
    .prepare("SELECT * FROM trigger_runs WHERE status = 'queued' ORDER BY created_at LIMIT 1")
    .get() as TriggerRunRow | undefined;
  if (!next) return null;

  db.prepare("UPDATE trigger_runs SET status = 'running', started_at = ?, attempt = attempt + 1 WHERE id = ?").run(
    Date.now(),
    next.id,
  );
  return { ...next, status: 'running', started_at: Date.now(), attempt: next.attempt + 1 };
}

export function markRunSucceeded(db: Database.Database, id: string, output: string): void {
  db.prepare("UPDATE trigger_runs SET status = 'succeeded', output = ?, finished_at = ? WHERE id = ?").run(
    output,
    Date.now(),
    id,
  );
}

const MAX_ATTEMPTS = 3; // 初回 + リトライ2回

/** リトライ上限に達していなければ再度queuedへ戻す。達していればfailed/timeoutで確定する */
export function markRunFailed(
  db: Database.Database,
  id: string,
  attempt: number,
  error: string,
  isTimeout: boolean,
): void {
  if (attempt < MAX_ATTEMPTS) {
    db.prepare("UPDATE trigger_runs SET status = 'queued', error = ?, finished_at = NULL WHERE id = ?").run(
      error,
      id,
    );
    return;
  }
  const status = isTimeout ? 'timeout' : 'failed';
  db.prepare('UPDATE trigger_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(
    status,
    error,
    Date.now(),
    id,
  );
}

export function listTriggerRuns(db: Database.Database, userId: string, triggerId: string | null, limit: number) {
  return triggerId
    ? db
        .prepare(
          'SELECT * FROM trigger_runs WHERE user_id = ? AND trigger_id = ? ORDER BY created_at DESC LIMIT ?',
        )
        .all(userId, triggerId, limit)
    : db.prepare('SELECT * FROM trigger_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit);
}
