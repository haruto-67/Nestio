import { Hono } from 'hono';
import { listShareCreateRequestSchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import {
  inviteToList,
  listOutgoingShares,
  listIncomingShares,
  acceptShare,
  revokeShare,
  ShareError,
} from '../shares/list-shares.js';

export const listSharesRoute = new Hono<{ Variables: AppVariables }>();

listSharesRoute.use('/list-shares', requireAuth);
listSharesRoute.use('/list-shares/*', requireAuth);

function shareErrorToApiError(err: ShareError): ApiError {
  return new ApiError(err.code, err.message);
}

listSharesRoute.post('/list-shares', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = listShareCreateRequestSchema.parse(await c.req.json());
  try {
    const share = inviteToList(c.get('db'), userId, body.list_id, body.invited_email);
    return c.json(share, 201);
  } catch (err) {
    if (err instanceof ShareError) throw shareErrorToApiError(err);
    throw err;
  }
});

/** 自分が送った招待の一覧。?list_id=で絞り込み可 */
listSharesRoute.get('/list-shares/outgoing', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  return c.json(listOutgoingShares(c.get('db'), userId, c.req.query('list_id')));
});

/** 自分が受け取った招待の一覧（pending/accepted両方） */
listSharesRoute.get('/list-shares/incoming', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  return c.json(listIncomingShares(c.get('db'), userId));
});

listSharesRoute.post('/list-shares/:id/accept', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  try {
    return c.json(acceptShare(c.get('db'), userId, c.req.param('id')));
  } catch (err) {
    if (err instanceof ShareError) throw shareErrorToApiError(err);
    throw err;
  }
});

/** owner側からの解除、招待された側の離脱、どちらもこのエンドポイントで行う */
listSharesRoute.delete('/list-shares/:id', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  if (!revokeShare(c.get('db'), userId, c.req.param('id'))) {
    throw new ApiError('not_found', '共有が見つかりません');
  }
  return c.body(null, 204);
});
