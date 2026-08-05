import { Hono } from 'hono';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';

export const streakRoute = new Hono<{ Variables: AppVariables }>();

streakRoute.use('/tasks/*', requireAuth);

/**
 * 繰り返しタスクの連続達成数（改修5回目・改修4回目ブレインストーム案B「習慣トラッキング」）。
 * frequencyに応じた間隔の1.5倍以内に次の完了があれば連続とみなす簡易計算。
 * task_completionsは/syncの同期対象ではないため専用の読み取りAPIとして公開する。
 */
streakRoute.get('/tasks/:id/streak', (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const taskId = c.req.param('id');
  const task = db.prepare('SELECT user_id, rrule FROM tasks WHERE id = ?').get(taskId) as
    | { user_id: string; rrule: string | null }
    | undefined;
  if (!task || task.user_id !== userId) throw new ApiError('not_found', 'タスクが見つかりません');

  const rows = db
    .prepare('SELECT completed_at FROM task_completions WHERE task_id = ? ORDER BY completed_at DESC LIMIT 200')
    .all(taskId) as { completed_at: number }[];

  const intervalDays = task.rrule?.includes('FREQ=WEEKLY')
    ? 7
    : task.rrule?.includes('FREQ=MONTHLY')
      ? 30
      : 1;
  const graceMs = intervalDays * 1.5 * 24 * 60 * 60 * 1000;

  let streak = rows.length > 0 ? 1 : 0;
  for (let i = 1; i < rows.length; i++) {
    const current = rows[i - 1];
    const prev = rows[i];
    if (!current || !prev) break;
    if (current.completed_at - prev.completed_at <= graceMs) streak++;
    else break;
  }

  return c.json({ streak, total_completions: rows.length });
});
