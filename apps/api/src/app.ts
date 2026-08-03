import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
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
import { attachmentsRoute } from './routes/attachments.js';
import { pushRoute } from './routes/push.js';
import { calendarRoute } from './routes/calendar.js';
import { mcpRoute } from './routes/mcp.js';
import { hatchRoute } from './routes/hatch.js';
import { logsRoute } from './routes/logs.js';

export function createApp(env: Env, db: Database.Database, logger: Logger) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', requestContext(logger, env, db));
  app.onError(handleError);

  app.use('/api/v1/auth/*', rateLimit(env.RATE_LIMIT_AUTH));
  app.use('/api/v1/sync/*', rateLimit(env.RATE_LIMIT_SYNC));
  app.use('/api/v1/client-logs', rateLimit(env.RATE_LIMIT_CLIENT_LOGS));
  app.use('/api/v1/attachments/*', rateLimit(env.RATE_LIMIT_ATTACHMENT));
  app.use('/api/v1/mcp', rateLimit(env.RATE_LIMIT_MCP));
  app.use('/api/v1/mcp/*', rateLimit(env.RATE_LIMIT_MCP));

  app.route('/api/v1', healthRoute);
  app.route('/api/v1', authRoute);
  app.route('/api/v1', syncRoute);
  app.route('/api/v1', clientLogsRoute);
  app.route('/api/v1', searchRoute);
  app.route('/api/v1', attachmentsRoute);
  app.route('/api/v1', pushRoute);
  app.route('/api/v1', calendarRoute);
  app.route('/api/v1', mcpRoute);
  app.route('/api/v1', hatchRoute);
  app.route('/api/v1', logsRoute);

  // 本番のみ：ビルド済みPWAをこのプロセスから直接配信する（nginxはlocation /をここへ丸ごとproxy_passする構成、
  // docs/manual-setup.md C-3）。/api/v1/* に一致しないパスだけを対象にする。
  // 「'*'にマッチ かつ /api/ 配下ではない」場合のみindex.htmlへフォールバックしないと、
  // 未定義のAPIパス（例: 存在しないエンドポイントへのtypo）が404ではなくSPAのHTMLを200で返してしまう。
  if (env.WEB_DIST_DIR) {
    const webDistDir = env.WEB_DIST_DIR;
    app.use('/*', async (c, next) => {
      if (c.req.path.startsWith('/api/')) return next();
      return serveStatic({ root: webDistDir })(c, next);
    });
    app.get('*', async (c, next) => {
      if (c.req.path.startsWith('/api/')) return next();
      return serveStatic({ root: webDistDir, path: 'index.html' })(c, next);
    });
  }

  return app;
}

export type App = ReturnType<typeof createApp>;
