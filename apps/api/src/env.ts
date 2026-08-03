import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  APP_ORIGIN: z.string().url().default('http://localhost:5173'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SESSION_SECRET: z.string().default('dev-insecure-session-secret-change-me'),

  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:dev@example.com'),

  DB_PATH: z.string().default('./data/nestio.db'),
  ATTACHMENT_DIR: z.string().default('./data/attachments'),
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  ATTACHMENT_QUOTA_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024 * 1024),

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
