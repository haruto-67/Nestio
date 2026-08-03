import { createMiddleware } from 'hono/factory';
import type Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import type { Logger } from '../logger.js';
import type { Env } from '../env.js';

export type AppVariables = {
  requestId: string;
  logger: Logger;
  env: Env;
  db: Database.Database;
  userId?: string;
};

/** request_id を発番し、全リクエストの開始・終了をstructured logで記録する */
export function requestContext(baseLogger: Logger, env: Env, db: Database.Database) {
  return createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? uuidv7();
    const logger = baseLogger.child({ request_id: requestId });
    c.set('requestId', requestId);
    c.set('logger', logger);
    c.set('env', env);
    c.set('db', db);
    c.header('X-Request-Id', requestId);

    const startedAt = Date.now();
    logger.info({ method: c.req.method, path: c.req.path }, 'request_started');

    await next();

    const durationMs = Date.now() - startedAt;
    const status = c.res.status;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logger[level]({ method: c.req.method, path: c.req.path, status, duration_ms: durationMs }, 'request_finished');
  });
}
