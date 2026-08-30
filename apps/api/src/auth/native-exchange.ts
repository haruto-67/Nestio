import { randomToken } from './pkce.js';

/**
 * Capacitor(iOS)のシステムブラウザ(SFSafariViewController)経由のGoogleログイン用ワンタイム
 * 引き換えトークン。SFSafariViewControllerはSafari.appとCookieストアを共有するが、アプリ本体の
 * WKWebViewとは別ストアのため、SFSafariViewController内でセッションCookieを発行してもアプリ側には
 * 届かない（改修20回目）。そこでカスタムURLスキーム経由でこのトークンをアプリへ渡し、
 * アプリ本体のWKWebViewから /auth/native-exchange を叩かせることで、正しいCookieストアに
 * セッションCookieを発行させる。
 */
const EXCHANGE_TTL_MS = 60 * 1000;

interface ExchangeEntry {
  sessionId: string;
  expiresAt: number;
}

const exchanges = new Map<string, ExchangeEntry>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [token, entry] of exchanges) {
    if (entry.expiresAt < now) exchanges.delete(token);
  }
}

export function createNativeExchangeToken(sessionId: string): string {
  sweepExpired();
  const token = randomToken(32);
  exchanges.set(token, { sessionId, expiresAt: Date.now() + EXCHANGE_TTL_MS });
  return token;
}

/** 一度読み出したトークンは即座に無効化する（使い捨て） */
export function consumeNativeExchangeToken(token: string): string | undefined {
  const entry = exchanges.get(token);
  if (!entry) return undefined;
  exchanges.delete(token);
  if (entry.expiresAt < Date.now()) return undefined;
  return entry.sessionId;
}
