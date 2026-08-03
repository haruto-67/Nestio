import pino from 'pino';
import path from 'node:path';
import type { Env } from './env.js';

/** ログに絶対出してはいけないキー。ネストしたパスも含めてマスクする */
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  '*.password',
  '*.token',
  '*.token_hash',
  '*.access_token',
  '*.refresh_token',
  '*.session_secret',
  '*.client_secret',
  '*.vapid_private_key',
  '*.p256dh',
  '*.auth',
];

export function createLogger(env: Env) {
  const isDev = env.NODE_ENV === 'development';

  const destination = isDev
    ? undefined
    : {
        target: 'pino-roll',
        options: {
          file: path.join(env.LOG_DIR, 'nestio'),
          extension: '.log',
          frequency: 'daily',
          dateFormat: 'yyyy-MM-dd',
          mkdir: true,
          limit: { count: env.LOG_RETENTION_DAYS },
        },
      };

  const transport = isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
    : destination;

  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: pino.stdSerializers.err },
    transport,
  });
}

export type Logger = ReturnType<typeof createLogger>;
