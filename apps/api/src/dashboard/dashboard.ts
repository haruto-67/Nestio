import type Database from 'better-sqlite3';
import {
  compareTasksByDue,
  isInTodayView,
  isOverdue,
  todayCompletionStats,
  todayJstDateString,
  type DashboardPomodoro,
  type DashboardToday,
} from '@nestio/shared';

/**
 * iPad常時表示ダッシュボード向けの読み取り専用API（改修26回目）。「今日」の対象・並び順・
 * 達成数はWebの「今日」タブと同じpackages/sharedの関数で決め、API専用のルールは持たない
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** epoch msをオフセット付きISO 8601（例: 2026-09-26T18:00:00+09:00）にする */
export function toJstIso(epochMs: number): string {
  return `${new Date(epochMs + JST_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}

interface TaskForToday {
  id: string;
  title: string;
  list_id: string;
  due_at: number | null;
  due_date: string | null;
  completed_at: number | null;
  sort_order: number;
}

/**
 * Webの「今日」タブが見ているのは端末に同期された全タスク＝自分のタスクと、共有を受けている
 * リスト（直接共有・フォルダ共有）のタスク。同じ範囲をSQLで取る。並びの同点はDexieの
 * toArray()と同じく主キー（UUIDv7＝作成順）の順にする
 */
function selectTasksWithDue(db: Database.Database, userId: string): TaskForToday[] {
  return db
    .prepare(
      `SELECT id, title, list_id, due_at, due_date, completed_at, sort_order FROM tasks
       WHERE deleted_at IS NULL
         AND (due_at IS NOT NULL OR due_date IS NOT NULL)
         AND (
           user_id = @userId
           OR list_id IN (
             SELECT list_id FROM list_shares
             WHERE invited_user_id = @userId AND status = 'accepted' AND deleted_at IS NULL
           )
           OR list_id IN (
             SELECT lists.id FROM lists
             JOIN folder_shares ON folder_shares.folder_id = lists.folder_id
             WHERE folder_shares.invited_user_id = @userId
               AND folder_shares.status = 'accepted' AND folder_shares.deleted_at IS NULL
           )
         )
       ORDER BY id`,
    )
    .all({ userId }) as TaskForToday[];
}

export function getDashboardToday(db: Database.Database, userId: string, now: number = Date.now()): DashboardToday {
  const today = todayJstDateString(now);
  const tasks = selectTasksWithDue(db, userId);
  const stats = todayCompletionStats(tasks, today);

  return {
    date: today,
    done_count: stats.completed,
    total_count: stats.total,
    tasks: tasks
      .filter((t) => isInTodayView(t, today))
      .sort(compareTasksByDue)
      .map((t) => ({
        id: t.id,
        title: t.title,
        due_at: t.due_at === null ? null : toJstIso(t.due_at),
        due_date: t.due_date,
        done: t.completed_at !== null,
        completed_at: t.completed_at === null ? null : toJstIso(t.completed_at),
        list_id: t.list_id,
        overdue: isOverdue(t, today),
      })),
  };
}

/** 5分プリセット（PomodoroTimerのPRESETS）以下は休憩、それより長いものは集中とみなす */
const BREAK_MAX_SEC = 5 * 60;

/**
 * ポモドーロの状態は端末のlocalStorageにあるが、開始時に必ず終了通知の予約
 * （scheduled_pushes kind='pomodoro'）がサーバーへ作られ、中断時は取り消される。
 * 「取り消されておらず終了時刻が未来の予約」を実行中のポモドーロとして返す
 */
export function getCurrentPomodoro(
  db: Database.Database,
  userId: string,
  now: number = Date.now(),
): DashboardPomodoro | null {
  const row = db
    .prepare(
      `SELECT scheduled_pushes.task_id AS task_id, scheduled_pushes.fire_at AS fire_at,
              scheduled_pushes.created_at AS created_at, tasks.title AS task_title
       FROM scheduled_pushes
       LEFT JOIN tasks ON tasks.id = scheduled_pushes.task_id AND tasks.deleted_at IS NULL
       WHERE scheduled_pushes.user_id = ? AND scheduled_pushes.kind = 'pomodoro'
         AND scheduled_pushes.canceled_at IS NULL AND scheduled_pushes.fire_at > ?
       ORDER BY scheduled_pushes.created_at DESC
       LIMIT 1`,
    )
    .get(userId, now) as
    | { task_id: string | null; fire_at: number; created_at: number; task_title: string | null }
    | undefined;
  if (!row) return null;

  const durationSec = Math.round((row.fire_at - row.created_at) / 1000);
  return {
    task_id: row.task_id,
    task_title: row.task_title,
    phase: durationSec <= BREAK_MAX_SEC ? 'break' : 'focus',
    started_at: toJstIso(row.created_at),
    ends_at: toJstIso(row.fire_at),
    duration_sec: durationSec,
    round: null,
    total_rounds: null,
    next_break_min: null,
    paused: false,
  };
}
