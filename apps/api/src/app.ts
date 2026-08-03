import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import type { Env } from './env.js';
import type { Logger } from './logger.js';
import { requestContext, type AppVariables } from './middleware/request-context.js';
import { handleError } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';
import { healthRoute } from './routes/health.js';
import { authRoute } from './routes/auth.js';
import { syncRoute } from './routes/sync.js';
import { clientLogsRoute } from './routes/client-logs.js';
import { searchRoute } from './routes/search.js';

export function createApp(env: Env, db: Database.Database, logger: Logger) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', requestContext(logger, env, db));
  app.onError(handleError);

  app.use('/api/v1/auth/*', rateLimit(env.RATE_LIMIT_AUTH));
  app.use('/api/v1/sync/*', rateLimit(env.RATE_LIMIT_SYNC));
  app.use('/api/v1/client-logs', rateLimit(env.RATE_LIMIT_CLIENT_LOGS));

  app.route('/api/v1', healthRoute);
  app.route('/api/v1', authRoute);
  app.route('/api/v1', syncRoute);
  app.route('/api/v1', clientLogsRoute);
  app.route('/api/v1', searchRoute);

  return app;
}

export type App = ReturnType<typeof createApp>;
