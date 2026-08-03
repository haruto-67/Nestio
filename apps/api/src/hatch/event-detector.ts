import type Database from 'better-sqlite3';
import { enqueueTriggerRun } from './queue.js';

interface TriggerCandidate {
  id: string;
  condition_json: string;
}

interface TaskContext {
  id: string;
  list_id: string;
  priority: number;
}

function matchesTaskCondition(conditionJson: string, task: TaskContext): boolean {
  let condition: { list_id?: string; priority?: number };
  try {
    condition = JSON.parse(conditionJson || '{}') as { list_id?: string; priority?: number };
  } catch {
    return false;
  }
  if (condition.list_id !== undefined && condition.list_id !== task.list_id) return false;
  if (condition.priority !== undefined && condition.priority !== task.priority) return false;
  return true;
}

/**
 * task_completed / task_created イベントを検知し、条件に一致する有効なトリガーをキューに積む。
 * トリガー起因の書き込み（Hatchアクション自体がタスクを作成・完了させた場合）からは
 * 再発火させない（ループ防止。要件定義3.10）。
 */
export function detectTaskEvent(
  db: Database.Database,
  userId: string,
  event: 'task_completed' | 'task_created',
  task: TaskContext,
  triggeredByHatch: boolean,
): void {
  if (triggeredByHatch) return;

  const triggers = db
    .prepare(
      `SELECT id, condition_json FROM triggers
       WHERE user_id = ? AND event = ? AND enabled = 1 AND deleted_at IS NULL`,
    )
    .all(userId, event) as TriggerCandidate[];

  for (const trigger of triggers) {
    if (matchesTaskCondition(trigger.condition_json, task)) {
      enqueueTriggerRun(db, userId, trigger.id, task.id);
    }
  }
}

/** リスト内の全タスクが完了した瞬間を検知する（1件でもタスクが必要。空リストは対象外） */
export function detectListAllCompleted(
  db: Database.Database,
  userId: string,
  listId: string,
  triggeredByHatch: boolean,
): void {
  if (triggeredByHatch) return;

  const incomplete = db
    .prepare('SELECT 1 FROM tasks WHERE list_id = ? AND deleted_at IS NULL AND completed_at IS NULL LIMIT 1')
    .get(listId);
  if (incomplete) return;

  const total = db
    .prepare('SELECT COUNT(*) as c FROM tasks WHERE list_id = ? AND deleted_at IS NULL')
    .get(listId) as { c: number };
  if (total.c === 0) return;

  const triggers = db
    .prepare(
      `SELECT id, condition_json FROM triggers
       WHERE user_id = ? AND event = 'list_all_completed' AND enabled = 1 AND deleted_at IS NULL`,
    )
    .all(userId) as TriggerCandidate[];

  for (const trigger of triggers) {
    let condition: { list_id?: string } = {};
    try {
      condition = JSON.parse(trigger.condition_json || '{}') as { list_id?: string };
    } catch {
      continue;
    }
    if (condition.list_id && condition.list_id !== listId) continue;
    enqueueTriggerRun(db, userId, trigger.id, listId);
  }
}
