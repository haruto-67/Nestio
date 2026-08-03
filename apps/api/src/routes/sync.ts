import { Hono } from 'hono';
import { syncPushRequestSchema, syncPullQuerySchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { applySyncOps } from '../sync/apply.js';
import { pullChanges } from '../sync/pull.js';

export const syncRoute = new Hono<{ Variables: AppVariables }>();

syncRoute.use('/sync/*', requireAuth);

syncRoute.post('/sync/push', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const logger = c.get('logger');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = syncPushRequestSchema.parse(await c.req.json());
  const result = applySyncOps(db, userId, body.ops);

  if (result.rejected.length > 0) {
    logger.info({ rejected: result.rejected }, 'sync_push_rejected_ops');
  }

  return c.json(result);
});

syncRoute.get('/sync/pull', (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const query = syncPullQuerySchema.parse({
    since: c.req.query('since'),
    limit: c.req.query('limit'),
  });

  const result = pullChanges(db, userId, query.since, query.limit);
  return c.json(result);
});
