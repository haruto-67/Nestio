import { Hono, type Context } from 'hono';
import { z } from 'zod';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { dynamicClientRegistrationRequestSchema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { registerOauthClient, findOauthClient } from '../mcp/clients.js';
import { issueAuthorizationCode, consumeAuthorizationCode } from '../mcp/authorization-codes.js';
import { issueAccessToken, verifyAccessToken } from '../mcp/tokens.js';
import { handleMcpRequest, type JsonRpcRequest } from '../mcp/jsonrpc.js';
import { renderConsentPage } from '../mcp/consent-page.js';
import { buildAuthServerMetadata } from '../mcp/metadata.js';

export const mcpRoute = new Hono<{ Variables: AppVariables }>();

mcpRoute.get('/mcp/.well-known/oauth-authorization-server', (c) => {
  return c.json(buildAuthServerMetadata(c.get('env')));
});

mcpRoute.post('/mcp/oauth/register', async (c) => {
  const db = c.get('db');
  const body = dynamicClientRegistrationRequestSchema.parse(await c.req.json());

  const result = registerOauthClient(db, body.client_name, body.redirect_uris);
  if (!result) {
    throw new ApiError('internal', 'ユーザーが見つかりません。先にNestioへGoogleログインしてください');
  }

  return c.json(
    { client_id: result.client_id, client_name: body.client_name, redirect_uris: body.redirect_uris },
    201,
  );
});

const authorizeQuerySchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  code_challenge: z.string(),
  code_challenge_method: z.literal('S256'),
  state: z.string().optional().default(''),
  scope: z.string().optional().default('read write'),
});

function validateClientAndRedirect(db: Database.Database, clientId: string, redirectUri: string) {
  const client = findOauthClient(db, clientId);
  if (!client) throw new ApiError('not_found', 'クライアントが見つかりません');

  const allowedRedirects = JSON.parse(client.redirect_uris) as string[];
  if (!allowedRedirects.includes(redirectUri)) {
    throw new ApiError('forbidden', 'redirect_uriが登録されたものと一致しません');
  }
  return client;
}

mcpRoute.get('/mcp/oauth/authorize', requireAuth, (c) => {
  const db = c.get('db');
  const query = authorizeQuerySchema.parse({
    client_id: c.req.query('client_id'),
    redirect_uri: c.req.query('redirect_uri'),
    code_challenge: c.req.query('code_challenge'),
    code_challenge_method: c.req.query('code_challenge_method'),
    state: c.req.query('state'),
    scope: c.req.query('scope'),
  });

  const client = validateClientAndRedirect(db, query.client_id, query.redirect_uri);

  return c.html(
    renderConsentPage(client.name, {
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      state: query.state,
      scope: query.scope,
    }),
  );
});

mcpRoute.post('/mcp/oauth/authorize', requireAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = await c.req.parseBody();
  const clientId = String(body.client_id ?? '');
  const redirectUri = String(body.redirect_uri ?? '');
  const codeChallenge = String(body.code_challenge ?? '');
  const state = String(body.state ?? '');
  const scope = String(body.scope ?? 'read write');

  validateClientAndRedirect(db, clientId, redirectUri);

  const code = issueAuthorizationCode({ userId, clientId, redirectUri, codeChallenge, scope });

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);
  return c.redirect(redirectUrl.toString());
});

const tokenRequestSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string(),
  redirect_uri: z.string().url(),
  client_id: z.string(),
  code_verifier: z.string(),
});

mcpRoute.post('/mcp/oauth/token', async (c) => {
  const db = c.get('db');
  const contentType = c.req.header('content-type') ?? '';
  const raw = contentType.includes('application/json') ? await c.req.json() : await c.req.parseBody();
  const body = tokenRequestSchema.parse(raw);

  const entry = consumeAuthorizationCode(body.code);
  if (!entry) throw new ApiError('forbidden', '認可コードが無効または期限切れです');
  if (entry.clientId !== body.client_id || entry.redirectUri !== body.redirect_uri) {
    throw new ApiError('forbidden', 'クライアント情報が一致しません');
  }

  // PKCE検証：S256のみ対応
  const computedChallenge = crypto.createHash('sha256').update(body.code_verifier).digest('base64url');
  if (computedChallenge !== entry.codeChallenge) {
    throw new ApiError('forbidden', 'code_verifierが一致しません');
  }

  const { token, expiresAt } = issueAccessToken(db, entry.userId, entry.clientId, entry.scope);
  return c.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: Math.floor((expiresAt - Date.now()) / 1000),
    scope: entry.scope,
  });
});

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** RFC 9728：401にWWW-Authenticateを付け、Protected Resource Metadataへ辿れるようにする */
function unauthorizedWithResourceMetadata(c: Context<{ Variables: AppVariables }>): never {
  const env = c.get('env');
  const origin = new URL(env.APP_ORIGIN).origin;
  c.header(
    'WWW-Authenticate',
    `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  );
  throw new ApiError('unauthenticated', 'Bearerトークンが必要です');
}

mcpRoute.post('/mcp', async (c) => {
  const db = c.get('db');
  const authHeader = c.req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    unauthorizedWithResourceMetadata(c);
  }

  const verified = verifyAccessToken(db, authHeader.slice('Bearer '.length));
  if (!verified) throw new ApiError('unauthenticated', 'トークンが無効です');

  const body = jsonRpcRequestSchema.parse(await c.req.json());
  const response = await handleMcpRequest(db, c.get('env'), verified, body as JsonRpcRequest);
  return c.json(response);
});
