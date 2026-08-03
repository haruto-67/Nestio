import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import type { Env } from './env.js';
import type { Logger } from './logger.js';
import { requestContext, type AppVariables } from './middleware/request-context.js';
import { handleError } from './middleware/error-handler.js';
import { healthRoute } from './routes/health.js';

export function createApp(env: Env, db: Database.Database, logger: Logger) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', requestContext(logger, env, db));
  app.onError(handleError);

  app.route('/api/v1', healthRoute);

  return app;
}

export type App = ReturnType<typeof createApp>;
