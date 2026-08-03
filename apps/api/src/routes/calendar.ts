import { Hono } from 'hono';
import { calendarFeedCreateRequestSchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import {
  createCalendarFeed,
  listCalendarFeeds,
  revokeCalendarFeed,
  findActiveFeedByToken,
} from '../calendar/feeds.js';
import { generateIcsFeed } from '../calendar/ics-generator.js';

export const calendarRoute = new Hono<{ Variables: AppVariables }>();

calendarRoute.use('/calendar/feeds', requireAuth);
calendarRoute.use('/calendar/feeds/*', requireAuth);

calendarRoute.post('/calendar/feeds', async (c) => {
  const db = c.get('db');
  const env = c.get('env');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const raw = await c.req.json().catch(() => ({}));
  const body = calendarFeedCreateRequestSchema.parse(raw);
  const { token } = createCalendarFeed(db, userId, body.list_id ?? null);

  const origin = new URL(env.APP_ORIGIN).origin;
  return c.json({ token, url: `${origin}/api/v1/calendar/${token}.ics` }, 201);
});

calendarRoute.get('/calendar/feeds', (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  return c.json(listCalendarFeeds(db, userId));
});

calendarRoute.delete('/calendar/feeds/:id', (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  if (!revokeCalendarFeed(db, userId, c.req.param('id'))) {
    throw new ApiError('not_found', 'フィードが見つかりません');
  }
  return c.body(null, 204);
});

interface TaskForIcsRow {
  id: string;
  title: string;
  due_at: number | null;
  due_date: string | null;
  rrule: string | null;
}

/**
 * カレンダーアプリはCookieを送れないため認証不要（requireAuthの対象外）。
 * トークン自体が32バイトのランダム値で推測不能なため、これが認可の代わりになる。
 */
calendarRoute.get('/calendar/:tokenFile', (c) => {
  const db = c.get('db');
  const tokenFile = c.req.param('tokenFile');
  if (!tokenFile.endsWith('.ics')) {
    throw new ApiError('not_found', '見つかりません');
  }
  const token = tokenFile.slice(0, -'.ics'.length);

  const feed = findActiveFeedByToken(db, token);
  if (!feed) throw new ApiError('not_found', 'フィードが見つかりません');

  const tasks = feed.list_id
    ? (db
        .prepare(
          `SELECT id, title, due_at, due_date, rrule FROM tasks
           WHERE user_id = ? AND deleted_at IS NULL AND completed_at IS NULL AND list_id = ?`,
        )
        .all(feed.user_id, feed.list_id) as TaskForIcsRow[])
    : (db
        .prepare(
          `SELECT id, title, due_at, due_date, rrule FROM tasks
           WHERE user_id = ? AND deleted_at IS NULL AND completed_at IS NULL`,
        )
        .all(feed.user_id) as TaskForIcsRow[]);

  const ics = generateIcsFeed(tasks);

  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Cache-Control', 'private, max-age=300');
  return c.body(ics);
});
