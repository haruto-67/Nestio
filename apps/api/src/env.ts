import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  APP_ORIGIN: z.string().url().default('http://localhost:5173'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().url().default('http://localhost:3000/api/v1/auth/google/callback'),
  SESSION_SECRET: z.string().default('dev-insecure-session-secret-change-me'),
  /** このメールアドレスでログインした人だけが管理者（アカウント申請の承認・サーバーログ閲覧）になる。
   *  役割テーブルを持つほどの規模ではないため、単一の管理者を環境変数で固定する（改修10回目） */
  ADMIN_EMAIL: z.string().default(''),

  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:dev@example.com'),

  /** 本番のDockerイメージでのみ設定する。ビルド済みPWA（apps/web/dist）を配信するディレクトリ。
   *  未設定（開発時）は静的配信を行わない（開発はVite dev serverが別ポートで担当するため）。 */
  WEB_DIST_DIR: z.string().default(''),

  DB_PATH: z.string().default('./data/nestio.db'),
  ATTACHMENT_DIR: z.string().default('./data/attachments'),
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  ATTACHMENT_QUOTA_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),
  /** base64エンコードされた32バイト鍵。未設定なら添付は平文で保存する（改修5回目） */
  ATTACHMENT_ENCRYPTION_KEY: z.string().default(''),

  CLAUDE_BIN: z.string().default(''),
  CLAUDE_WORKDIR: z.string().default(''),
  CLAUDE_TIMEOUT_SEC: z.coerce.number().int().positive().default(120),
  HATCH_SCRIPTS: z.string().default(''),
  DISCORD_WEBHOOKS: z.string().default(''),

  TOMBSTONE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_DIR: z.string().default('./data/logs'),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(14),

  RATE_LIMIT_SYNC: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_AUTH: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_MCP: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_ATTACHMENT: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_CLIENT_LOGS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error('環境変数の検証に失敗しました:', result.error.flatten().fieldErrors);
    throw new Error('invalid environment variables');
  }
  return result.data;
}
