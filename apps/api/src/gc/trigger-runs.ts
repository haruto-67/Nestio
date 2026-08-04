import type Database from 'better-sqlite3';

/**
 * Hatchの実行ログ（trigger_runs）は成功分も含めてどんどん溜まっていくため、
 * tombstone等と同じ保持期間（TOMBSTONE_RETENTION_DAYS）で古いものを物理削除する
 * （改修4回目：「成功ログがすごい溜まっていく」への対応）
 */
export function purgeOldTriggerRuns(db: Database.Database, retentionDays: number): { deletedRows: number } {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const result = db.prepare('DELETE FROM trigger_runs WHERE created_at < ?').run(cutoff);
  return { deletedRows: result.changes };
}
