import { Hono } from 'hono';
import { uuidv7 } from '@nestio/shared';
import { z } from 'zod';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { buildGoogleAuthUrl, exchangeCodeForUserInfo } from '../auth/google.js';
import { randomToken, generatePkcePair } from '../auth/pkce.js';
import { setOAuthFlowCookies, readOAuthFlowCookies, clearOAuthFlowCookies } from '../auth/oauth-flow-cookies.js';
import { createNativeExchangeToken, consumeNativeExchangeToken } from '../auth/native-exchange.js';
import { renderLoginBouncePage } from '../auth/login-bounce-page.js';
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

// iOSアプリのCFBundleURLSchemes（Info.plist / capacitor.config.tsのappIdと一致させる）。
// ユーザー入力ではなく固定文字列なのでオープンリダイレクトにはならない
const NATIVE_APP_CALLBACK_URL = 'com.niwatorimc.nestio://login-callback';

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

  // ログイン後に戻る先（改修17回目：MCPのOAuth認可画面が未ログインだった場合にここを経由させる
  // ため。オープンリダイレクト対策として、Nestio自身のパス（'/'始まり）のみ許可する）
  const returnToParam = c.req.query('return_to');
  const returnTo = returnToParam?.startsWith('/') ? returnToParam : undefined;

  // Capacitor(iOS)からシステムブラウザ経由で開かれた場合のフラグ（改修20回目）。
  // trueの場合、callback成功時にNESTIO_NATIVE_CALLBACK_URLへリダイレクトしてアプリ本体に
  // 制御を戻す。値は固定文字列'1'のみを見るサーバー内部フラグで、ユーザー入力のURLそのものを
  // リダイレクト先にするわけではないためオープンリダイレクトにはならない
  const native = c.req.query('native') === '1';

  setOAuthFlowCookies(c, { state, codeVerifier, returnTo, native }, env.NODE_ENV === 'production');

  const authUrl = buildGoogleAuthUrl(
    { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI },
    { state, codeChallenge },
  );

  return c.redirect(authUrl);
});

// iOS(Capacitor)のローカルdev server検証用：ローカルにGoogle OAuthの認証情報が無くても
// ログイン済み状態を作れるようにする一時的なショートカット。本番では必ず無効（改修20回目、検証後削除予定）
authRoute.get('/dev/login', (c) => {
  const env = c.get('env');
  if (env.NODE_ENV === 'production') {
    throw new ApiError('not_found', 'not found');
  }
  const db = c.get('db');
  const user = findOrCreateUser(db, {
    sub: 'dev-local-test-user',
    email: 'dev-local-test@example.com',
    email_verified: true,
    name: 'Dev Local Test User',
  });
  const { sessionId } = createSession(db, user.id, null);
  setSessionCookie(c, sessionId, false);
  return c.redirect('/');
});

authRoute.get('/auth/google/callback', async (c) => {
  const env = c.get('env');
  const db = c.get('db');
  const logger = c.get('logger');

  const code = c.req.query('code');
  const returnedState = c.req.query('state');
  const { state: savedState, codeVerifier, returnTo, native } = readOAuthFlowCookies(c);
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
      if (native) return c.redirect(`${NATIVE_APP_CALLBACK_URL}?login=${accessRequest.status}`);
      return c.redirect(`${env.APP_ORIGIN}/?login=${accessRequest.status}`);
    }
  }

  const user = findOrCreateUser(db, googleUser);
  const { sessionId } = createSession(db, user.id, null);

  logger.info({ user_id: user.id }, 'user_logged_in');

  // Capacitor(iOS)からシステムブラウザ(SFSafariViewController)経由でログインした場合、
  // この応答はSafari.appと共有のCookieストアで届くため、ここでsetSessionCookieしても
  // アプリ本体のWKWebViewには届かない。代わりにワンタイム引き換えトークンをカスタムURL
  // スキームでアプリへ渡し、WKWebView自身に /auth/native-exchange を叩かせることで
  // 正しいCookieストアにセッションCookieを発行させる（改修20回目）
  if (native) {
    const exchangeToken = createNativeExchangeToken(sessionId);
    return c.redirect(`${NATIVE_APP_CALLBACK_URL}?token=${exchangeToken}`);
  }

  setSessionCookie(c, sessionId, env.NODE_ENV === 'production');

  if (returnTo) {
    // MCPの認可画面など、Nestio自身の別ページへ戻る場合は直接302にせずbounceページを挟む
    // （理由はrenderLoginBouncePageのコメント参照）
    return c.html(renderLoginBouncePage(`${env.APP_ORIGIN}${returnTo}`));
  }
  return c.redirect(env.APP_ORIGIN);
});

// アプリ本体のWKWebViewから叩かせるための引き換えエンドポイント（改修20回目、上記コメント参照）。
// トークンは使い捨てかつ60秒で失効するため、通常のCookie発行APIと同等のリスクに収まる
authRoute.get('/auth/native-exchange', (c) => {
  const env = c.get('env');
  const token = c.req.query('token');
  const sessionId = token ? consumeNativeExchangeToken(token) : undefined;
  if (!sessionId) {
    throw new ApiError('forbidden', 'トークンが無効か期限切れです');
  }
  setSessionCookie(c, sessionId, env.NODE_ENV === 'production');
  return c.body(null, 204);
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

  // 今ログイン中のこのデバイスを一番上に固定表示したいという要望（改修15回目）に対応するため、
  // is_current相当（s.id = currentSessionId）を第一キーにする
  const rows = db
    .prepare(
      `SELECT s.id, s.created_at, s.expires_at, d.label AS device_label, d.last_seen AS device_last_seen
       FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
       WHERE s.user_id = ? AND s.expires_at > ?
       ORDER BY (s.id = ?) DESC, s.created_at DESC`,
    )
    .all(userId, Date.now(), currentSessionId ?? '') as {
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
