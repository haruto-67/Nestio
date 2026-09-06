import { Hono } from 'hono';
import { folderShareCreateRequestSchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import {
  inviteToFolder,
  listOutgoingFolderShares,
  listIncomingFolderShares,
  acceptFolderShare,
  revokeFolderShare,
} from '../shares/folder-shares.js';
import { ShareError } from '../shares/list-shares.js';

export const folderSharesRoute = new Hono<{ Variables: AppVariables }>();

folderSharesRoute.use('/folder-shares', requireAuth);
folderSharesRoute.use('/folder-shares/*', requireAuth);

function shareErrorToApiError(err: ShareError): ApiError {
  return new ApiError(err.code, err.message);
}

folderSharesRoute.post('/folder-shares', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = folderShareCreateRequestSchema.parse(await c.req.json());
  try {
    const share = inviteToFolder(c.get('db'), userId, body.folder_id, body.invited_email);
    return c.json(share, 201);
  } catch (err) {
    if (err instanceof ShareError) throw shareErrorToApiError(err);
    throw err;
  }
});

/** 自分が送った招待の一覧。?folder_id=で絞り込み可 */
folderSharesRoute.get('/folder-shares/outgoing', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  return c.json(listOutgoingFolderShares(c.get('db'), userId, c.req.query('folder_id')));
});

/** 自分が受け取った招待の一覧（pending/accepted両方） */
folderSharesRoute.get('/folder-shares/incoming', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  return c.json(listIncomingFolderShares(c.get('db'), userId));
});

folderSharesRoute.post('/folder-shares/:id/accept', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  try {
    return c.json(acceptFolderShare(c.get('db'), userId, c.req.param('id')));
  } catch (err) {
    if (err instanceof ShareError) throw shareErrorToApiError(err);
    throw err;
  }
});

/** owner側からの解除、招待された側の離脱、どちらもこのエンドポイントで行う */
folderSharesRoute.delete('/folder-shares/:id', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  if (!revokeFolderShare(c.get('db'), userId, c.req.param('id'))) {
    throw new ApiError('not_found', '共有が見つかりません');
  }
  return c.body(null, 204);
});
