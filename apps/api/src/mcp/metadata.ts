import type { Env } from '../env.js';

/**
 * MCP Authorization仕様（RFC 9728 Protected Resource Metadata + RFC 8414 Authorization
 * Server Metadata）に基づくディスカバリー用メタデータ。
 * クライアントは 401 応答の WWW-Authenticate ヘッダーからProtected Resource Metadataの
 * URLを辿り、そこに書かれた authorization_servers からAuthorization Server Metadataを
 * 取得する流れを想定する（実際にClaude側で接続できないケースがあり、この2段階が
 * 欠けていたことが原因だった。docs/open-questions.md参照）。
 */
export function mcpResourceUrl(env: Env): string {
  return `${new URL(env.APP_ORIGIN).origin}/api/v1/mcp`;
}

export function buildProtectedResourceMetadata(env: Env) {
  const resource = mcpResourceUrl(env);
  return {
    resource,
    authorization_servers: [resource],
  };
}

export function buildAuthServerMetadata(env: Env) {
  const base = mcpResourceUrl(env);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: ['read', 'write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}
