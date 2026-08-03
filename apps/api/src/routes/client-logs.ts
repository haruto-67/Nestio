import { Hono } from 'hono';
import { clientLogsRequestSchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';

export const clientLogsRoute = new Hono<{ Variables: AppVariables }>();

clientLogsRoute.use('/client-logs', requireAuth);

clientLogsRoute.post('/client-logs', async (c) => {
  const userId = c.get('userId');
  const logger = c.get('logger');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = clientLogsRequestSchema.parse(await c.req.json());

  for (const entry of body.entries) {
    logger[entry.level](
      {
        scope: 'client',
        user_id: userId,
        device_id: body.device_id,
        session_trace_id: body.session_trace_id,
        client_timestamp: entry.timestamp,
        context: entry.context,
      },
      entry.message,
    );
  }

  return c.body(null, 204);
});
