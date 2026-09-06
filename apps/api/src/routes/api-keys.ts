import { Hono } from 'hono';
import { apiKeyCreateRequestSchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { issueApiKey, listApiKeys, revokeApiKey } from '../api-keys/keys.js';

export const apiKeysRoute = new Hono<{ Variables: AppVariables }>();

apiKeysRoute.use('/api-keys', requireAuth);
apiKeysRoute.use('/api-keys/*', requireAuth);

apiKeysRoute.get('/api-keys', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  return c.json(listApiKeys(c.get('db'), userId));
});

apiKeysRoute.post('/api-keys', async (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = apiKeyCreateRequestSchema.parse(await c.req.json());
  // UIの選択肢は「読み取りのみ」「読み書き」の2択。oauth_tokensに合わせ内部的にはスペース区切りで保存する
  const scope = body.scope === 'write' ? 'read write' : 'read';
  const { id, key } = issueApiKey(c.get('db'), userId, body.name, scope);

  // keyは発行直後のこのレスポンスでしか手に入らない（DBにはハッシュしか残らない）
  return c.json({ id, key, name: body.name, scope }, 201);
});

apiKeysRoute.delete('/api-keys/:id', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  if (!revokeApiKey(c.get('db'), userId, c.req.param('id'))) {
    throw new ApiError('not_found', 'APIキーが見つかりません');
  }
  return c.body(null, 204);
});
