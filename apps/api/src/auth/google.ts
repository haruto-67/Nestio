const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildGoogleAuthUrl(
  config: GoogleOAuthConfig,
  params: { state: string; codeChallenge: string },
): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  // openid: IDトークンの発行 / email, profile: メールアドレスと表示名の取得
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // アカウント選択を毎回出す（複数Googleアカウントを使い分けるため）
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
}

/** 認可コードをアクセストークンに交換し、userinfoエンドポイントからプロフィールを取得する */
export async function exchangeCodeForUserInfo(
  config: GoogleOAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<GoogleUserInfo> {
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Google token exchange failed: ${tokenRes.status}`);
  }
  const tokenBody = (await tokenRes.json()) as { access_token: string };

  const userInfoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  if (!userInfoRes.ok) {
    throw new Error(`Google userinfo request failed: ${userInfoRes.status}`);
  }

  return (await userInfoRes.json()) as GoogleUserInfo;
}
