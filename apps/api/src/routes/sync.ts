import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { syncPushRequestSchema, syncPullQuerySchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { applySyncOps } from '../sync/apply.js';
import { pullChanges } from '../sync/pull.js';
import { subscribeSse, broadcastBump } from '../sync/sse-hub.js';
import { detectClockSkewMs } from '../sync/clock-skew.js';

const SSE_KEEPALIVE_MS = 30_000;

export const syncRoute = new Hono<{ Variables: AppVariables }>();

syncRoute.use('/sync/*', requireAuth);

syncRoute.post('/sync/push', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const logger = c.get('logger');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = syncPushRequestSchema.parse(await c.req.json());
  const result = applySyncOps(db, userId, body.ops);

  const clockSkewMs = detectClockSkewMs(body.ops.map((op) => op.updated_at));
  if (clockSkewMs !== undefined) {
    logger.warn({ clock_skew_ms: clockSkewMs, device_id: body.device_id }, 'clock_skew_detected');
  }

  if (result.rejected.length > 0) {
    logger.info({ rejected: result.rejected }, 'sync_push_rejected_ops');
  }
  if (result.applied.length > 0) {
    broadcastBump(userId, result.next_seq, body.device_id);
  }

  return c.json(clockSkewMs !== undefined ? { ...result, clock_skew_ms: clockSkewMs } : result);
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

/**
 * sync-protocol.md 7章：ペイロードはseqのみ。実データは送らず、
 * 受け取ったクライアントが自分のseqより大きければpullを実行する設計。
 */
syncRoute.get('/sync/stream', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  return streamSSE(c, async (stream) => {
    const queue: string[] = [];
    let notify: (() => void) | null = null;

    const unsubscribe = subscribeSse(userId, {
      push: (payload) => {
        queue.push(payload);
        notify?.();
      },
    });
    stream.onAbort(() => unsubscribe());

    try {
      while (!stream.aborted) {
        if (queue.length > 0) {
          const payload = queue.shift() as string;
          await stream.writeSSE({ event: 'bump', data: payload });
          continue;
        }
        await Promise.race([
          new Promise<void>((resolve) => {
            notify = resolve;
          }),
          stream.sleep(SSE_KEEPALIVE_MS),
        ]);
        notify = null;
      }
    } finally {
      unsubscribe();
    }
  });
});
