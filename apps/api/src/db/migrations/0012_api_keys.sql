-- 「API化」機能（改修22回目）：MCP(OAuth 2.1)とは別に、外部スクリプト・Zapier等の
-- サービス連携から手軽に叩ける個人用APIキー認証を追加する。スコープ(read/write)・
-- 失効・最終使用日時を持たせる点はoauth_tokensと同じ設計に揃える。
-- 平文キーは保存せずハッシュのみ保存する（要件定義3.10・3.14と同じ方針）
CREATE TABLE api_keys (
  id            TEXT    NOT NULL PRIMARY KEY,
  user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  key_hash      TEXT    NOT NULL UNIQUE,
  -- スペース区切り。'read' / 'read write'
  scope         TEXT    NOT NULL DEFAULT 'read',
  last_used_at  INTEGER,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
) STRICT;
CREATE INDEX idx_api_keys_user ON api_keys(user_id);
