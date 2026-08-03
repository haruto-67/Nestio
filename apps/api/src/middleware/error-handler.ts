import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@nestio/shared';
import { ApiError } from '../errors.js';
import type { AppVariables } from './request-context.js';

/** 未処理例外・API拒否をすべてこの形式に正規化する。例外は必ずスタックトレース付きで記録する */
export function handleError(err: Error, c: Context<{ Variables: AppVariables }>): Response {
  const logger = c.get('logger');

  if (err instanceof ApiError) {
    logger.warn({ err, code: err.code }, 'api_error');
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    return c.json(body, err.status as 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500);
  }

  if (err instanceof ZodError) {
    logger.warn({ err: err.flatten() }, 'validation_failed');
    const body: ApiErrorBody = { error: { code: 'validation_failed', message: 'リクエストの検証に失敗しました' } };
    return c.json(body, 400);
  }

  if (err instanceof HTTPException) {
    logger.warn({ err, status: err.status }, 'http_exception');
    const code = err.status === 401 ? 'unauthenticated' : err.status === 404 ? 'not_found' : 'internal';
    const body: ApiErrorBody = { error: { code, message: err.message } };
    return c.json(body, err.status);
  }

  logger.error({ err, stack: err.stack }, 'unhandled_exception');
  const body: ApiErrorBody = { error: { code: 'internal', message: '内部エラーが発生しました' } };
  return c.json(body, 500);
}
