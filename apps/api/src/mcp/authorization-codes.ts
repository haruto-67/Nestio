import { randomToken } from '../auth/pkce.js';

interface StoredAuthCode {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000;

/**
 * `oauth_tokens`（発行済みアクセストークン）はschema.sqlにあるが、認可コード（数分で失効する
 * 一時的な値）を保存するテーブルは存在しない。ここに新規テーブルを追加するとschema.sqlを
 * 変更することになるため、メモリ内Mapで管理する（docs/open-questions.md 12章）。
 */
const codes = new Map<string, StoredAuthCode>();

export function issueAuthorizationCode(data: Omit<StoredAuthCode, 'expiresAt'>): string {
  const code = randomToken(32);
  codes.set(code, { ...data, expiresAt: Date.now() + TTL_MS });
  return code;
}

/** 一度きりの使用（再送防止）。取得と同時に削除する */
export function consumeAuthorizationCode(code: string): StoredAuthCode | null {
  const entry = codes.get(code);
  if (!entry) return null;
  codes.delete(code);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}
