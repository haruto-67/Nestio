import { serve } from '@hono/node-server';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createDbConnection } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './app.js';
import { startPushWorker } from './push/worker.js';

const env = loadEnv();
const logger = createLogger(env);
const db = createDbConnection(env.DB_PATH);

const { applied } = runMigrations(db);
if (applied.length > 0) {
  logger.info({ applied }, 'migrations_applied');
}

const app = createApp(env, db, logger);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, 'server_started');
});

const stopPushWorker = startPushWorker(db, env, logger);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'server_shutting_down');
    stopPushWorker();
    db.close();
    process.exit(0);
  });
}
