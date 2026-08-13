import { Hono } from 'hono';
import { uuidv7 } from '@nestio/shared';
import { z } from 'zod';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { buildGoogleAuthUrl, exchangeCodeForUserInfo } from '../auth/google.js';
import { randomToken, generatePkcePair } from '../auth/pkce.js';
import { setOAuthFlowCookies, readOAuthFlowCookies, clearOAuthFlowCookies } from '../auth/oauth-flow-cookies.js';
import {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionIdFromRequest,
  destroySession,
} from '../auth/session.js';
import { findOrCreateUser, findUserById, findUserByGoogleSub, findUserByEmail } from '../auth/users.js';
import { findAccessRequestBySub, createAccessRequest } from '../auth/access-requests.js';
import { sendPushToUser } from '../push/sender.js';
import type { Env } from '../env.js';
import type Database from 'better-sqlite3';
import type { Logger } from '../logger.js';
import type { AccessRequestRow } from '../auth/access-requests.js';

export const authRoute = new Hono<{ Variables: AppVariables }>();

/** 新規申請があったことに管理者が気づけるよう、管理者アカウント宛にPush通知する（改修10回目） */
async function notifyAdminOfNewAccessRequest(
  db: Database.Database,
  env: Env,
  logger: Logger,
  req: AccessRequestRow,
): Promise<void> {
  if (!env.ADMIN_EMAIL) return;
  const admin = findUserByEmail(db, env.ADMIN_EMAIL);
  if (!admin) return;
  await sendPushToUser(db, env, logger, admin.id, {
    title: '新しいアカウント申請',
    body: `${req.display_name} (${req.email}) から申請がありました`,
  });
}

authRoute.get('/auth/google', async (c) => {
  const env = c.get('env');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new ApiError('internal', 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が未設定です');
  }

  const state = randomToken(24);
  const { codeVerifier, codeChallenge } = await generatePkcePair();

  setOAuthFlowCookies(c, { state, codeVerifier }, env.NODE_ENV === 'production');

  const authUrl = buildGoogleAuthUrl(
    { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI },
    { state, codeChallenge },
  );

  return c.redirect(authUrl);
});

authRoute.get('/auth/google/callback', async (c) => {
  const env = c.get('env');
  const db = c.get('db');
  const logger = c.get('logger');

  const code = c.req.query('code');
  const returnedState = c.req.query('state');
  const { state: savedState, codeVerifier } = readOAuthFlowCookies(c);
  clearOAuthFlowCookies(c);

  if (!code || !returnedState || !savedState || !codeVerifier || returnedState !== savedState) {
    throw new ApiError('forbidden', 'stateの検証に失敗しました');
  }

  const googleUser = await exchangeCodeForUserInfo(
    { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI },
    code,
    codeVerifier,
  );

  if (!googleUser.email_verified) {
    logger.warn({ google_sub: googleUser.sub }, 'unverified_email_login_attempt');
    throw new ApiError('forbidden', 'メールアドレスが未検証のGoogleアカウントです');
  }

  // 既存ユーザーでも管理者(ADMIN_EMAIL)でもない初回ログインは、即usersに登録せず
  // 管理者の承認を待つ申請制にする（改修10回目。誰でも使えてしまう状態への対応）
  const existingUser = findUserByGoogleSub(db, googleUser.sub);
  const isAdmin = env.ADMIN_EMAIL !== '' && googleUser.email === env.ADMIN_EMAIL;
  if (!existingUser && !isAdmin) {
    let accessRequest = findAccessRequestBySub(db, googleUser.sub);
    const isNewRequest = !accessRequest;
    if (!accessRequest) accessRequest = createAccessRequest(db, googleUser);

    if (accessRequest.status !== 'approved') {
      if (isNewRequest) {
        notifyAdminOfNewAccessRequest(db, env, logger, accessRequest).catch((err) =>
          logger.error({ err }, 'access_request_admin_notify_failed'),
        );
      }
      logger.info(
        { google_sub: googleUser.sub, status: accessRequest.status },
        'access_request_login_blocked',
      );
      return c.redirect(`${env.APP_ORIGIN}/?login=${accessRequest.status}`);
    }
  }

  const user = findOrCreateUser(db, googleUser);
  const { sessionId } = createSession(db, user.id, null);
  setSessionCookie(c, sessionId, env.NODE_ENV === 'production');

  logger.info({ user_id: user.id }, 'user_logged_in');

  return c.redirect(env.APP_ORIGIN);
});

authRoute.get('/auth/me', requireAuth, (c) => {
  const db = c.get('db');
  const env = c.get('env');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const user = findUserById(db, userId);
  if (!user) throw new ApiError('unauthenticated', 'ユーザーが見つかりません');

  return c.json({
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    is_admin: env.ADMIN_EMAIL !== '' && user.email === env.ADMIN_EMAIL,
  });
});

authRoute.post('/auth/logout', requireAuth, (c) => {
  const db = c.get('db');
  const sessionId = getSessionIdFromRequest(c);
  if (sessionId) destroySession(db, sessionId);
  clearSessionCookie(c);
  return c.body(null, 204);
});

/** ログイン中の全セッション一覧（改修5回目・改修4回目ブレインストーム案E「アクティブセッション一覧」） */
authRoute.get('/auth/sessions', requireAuth, (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  const currentSessionId = getSessionIdFromRequest(c);

  const rows = db
    .prepare(
      `SELECT s.id, s.created_at, s.expires_at, d.label AS device_label, d.last_seen AS device_last_seen
       FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
       WHERE s.user_id = ? AND s.expires_at > ?
       ORDER BY s.created_at DESC`,
    )
    .all(userId, Date.now()) as {
    id: string;
    created_at: number;
    expires_at: number;
    device_label: string | null;
    device_last_seen: number | null;
  }[];

  return c.json(
    rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      expires_at: r.expires_at,
      device_label: r.device_label,
      device_last_seen: r.device_last_seen,
      is_current: r.id === currentSessionId,
    })),
  );
});

/** 他デバイスのセッションを個別に失効させる（自分自身も含めてよい＝そのままログアウトになる） */
authRoute.delete('/auth/sessions/:id', requireAuth, (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const targetId = c.req.param('id');
  const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(targetId) as
    | { user_id: string }
    | undefined;
  if (!row) return c.body(null, 204);
  if (row.user_id !== userId) throw new ApiError('forbidden', '他ユーザーのセッションです');

  destroySession(db, targetId);
  if (targetId === getSessionIdFromRequest(c)) clearSessionCookie(c);
  return c.body(null, 204);
});

const deviceRequestSchema = z.object({ label: z.string().min(1).max(200) });

authRoute.post('/devices', requireAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const body = deviceRequestSchema.parse(await c.req.json());
  const deviceId = uuidv7();
  const now = Date.now();
  db.prepare('INSERT INTO devices (id, user_id, label, last_seen, created_at) VALUES (?, ?, ?, ?, ?)').run(
    deviceId,
    userId,
    body.label,
    now,
    now,
  );

  return c.json({ device_id: deviceId }, 201);
});
