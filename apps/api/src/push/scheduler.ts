import type Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';

const REMINDER_OFFSET_MS = 30 * 60 * 1000;

/** JST 9:00 = UTC 0:00（同日）。終日タスクは当日朝にリマインドする簡易実装 */
function dateOnlyToJstMorningEpochMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 0, 0, 0);
}

/**
 * タスクのdue_at/due_date更新時に呼ぶ。既存の未送信予約をキャンセルし、新しい期限で入れ直す
 * （api-spec.md 6章：「タスクのdue_at/due_date更新時に既存予約をキャンセルし、入れ直す」）。
 */
export function rescheduleDueReminder(
  db: Database.Database,
  userId: string,
  taskId: string,
  taskTitle: string,
  dueAt: number | null,
  dueDate: string | null,
  completedAt: number | null,
): void {
  db.prepare(
    `UPDATE scheduled_pushes SET canceled_at = ?
     WHERE task_id = ? AND kind = 'due_reminder' AND sent_at IS NULL AND canceled_at IS NULL`,
  ).run(Date.now(), taskId);

  if (completedAt !== null) return;

  let fireAt: number | null = null;
  if (dueAt !== null) {
    fireAt = dueAt - REMINDER_OFFSET_MS;
  } else if (dueDate !== null) {
    fireAt = dateOnlyToJstMorningEpochMs(dueDate);
  }

  if (fireAt === null || fireAt <= Date.now()) return;

  db.prepare(
    `INSERT INTO scheduled_pushes (id, user_id, kind, task_id, fire_at, title, body, created_at)
     VALUES (?, ?, 'due_reminder', ?, ?, ?, ?, ?)`,
  ).run(uuidv7(), userId, taskId, fireAt, '期限が近づいています', taskTitle, Date.now());
}

/** ポモドーロ終了時刻への予約。task_idは紐付けなしでも動く（要件定義3.4） */
export function schedulePomodoroPush(
  db: Database.Database,
  userId: string,
  durationSec: number,
  taskId: string | null,
): string {
  const id = uuidv7();
  const fireAt = Date.now() + durationSec * 1000;
  db.prepare(
    `INSERT INTO scheduled_pushes (id, user_id, kind, task_id, fire_at, title, body, created_at)
     VALUES (?, ?, 'pomodoro', ?, ?, 'ポモドーロ終了', '休憩しましょう', ?)`,
  ).run(id, userId, taskId, fireAt, Date.now());
  return id;
}

export function cancelScheduledPush(db: Database.Database, userId: string, id: string): boolean {
  const result = db
    .prepare(
      `UPDATE scheduled_pushes SET canceled_at = ?
       WHERE id = ? AND user_id = ? AND sent_at IS NULL AND canceled_at IS NULL`,
    )
    .run(Date.now(), id, userId);
  return result.changes > 0;
}
