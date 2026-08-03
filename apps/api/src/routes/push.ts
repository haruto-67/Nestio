import { Hono } from 'hono';
import { z } from 'zod';
import { uuidv7, pushSubscribeRequestSchema, pomodoroScheduleRequestSchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { schedulePomodoroPush, cancelScheduledPush } from '../push/scheduler.js';

export const pushRoute = new Hono<{ Variables: AppVariables }>();

pushRoute.get('/push/vapid-public-key', (c) => {
  const env = c.get('env');
  return c.json({ public_key: env.VAPID_PUBLIC_KEY });
});

pushRoute.use('/push/subscribe', requireAuth);
pushRoute.use('/pomodoro/*', requireAuth);

pushRoute.post('/push/subscribe', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = pushSubscribeRequestSchema.parse(await c.req.json());

  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, device_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(uuidv7(), userId, body.endpoint, body.keys.p256dh, body.keys.auth, Date.now());

  return c.body(null, 201);
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

pushRoute.delete('/push/subscribe', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = unsubscribeSchema.parse(await c.req.json());
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, body.endpoint);
  return c.body(null, 204);
});

pushRoute.post('/pomodoro/schedule', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = pomodoroScheduleRequestSchema.parse(await c.req.json());
  const id = schedulePomodoroPush(db, userId, body.duration_sec, body.task_id ?? null);
  return c.json({ id }, 201);
});

pushRoute.delete('/pomodoro/schedule/:id', (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const canceled = cancelScheduledPush(db, userId, c.req.param('id'));
  if (!canceled) throw new ApiError('not_found', '予約が見つかりません');
  return c.body(null, 204);
});
