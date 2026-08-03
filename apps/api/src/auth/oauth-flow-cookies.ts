import type { Context } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';

const STATE_COOKIE = 'nestio_oauth_state';
const VERIFIER_COOKIE = 'nestio_oauth_verifier';
const FLOW_TTL_SEC = 5 * 60;

/** /auth/google → /auth/google/callback の間だけ state・code_verifier を保持する短命Cookie */
export function setOAuthFlowCookies(
  c: Context,
  values: { state: string; codeVerifier: string },
  isProduction: boolean,
): void {
  const opts = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'Lax' as const, // Googleからのリダイレクトで戻ってくるためStrictだと送信されない
    path: '/',
    maxAge: FLOW_TTL_SEC,
  };
  setCookie(c, STATE_COOKIE, values.state, opts);
  setCookie(c, VERIFIER_COOKIE, values.codeVerifier, opts);
}

export function readOAuthFlowCookies(c: Context): { state?: string; codeVerifier?: string } {
  return {
    state: getCookie(c, STATE_COOKIE),
    codeVerifier: getCookie(c, VERIFIER_COOKIE),
  };
}

export function clearOAuthFlowCookies(c: Context): void {
  deleteCookie(c, STATE_COOKIE, { path: '/' });
  deleteCookie(c, VERIFIER_COOKIE, { path: '/' });
}
