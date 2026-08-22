-- MCP接続はAnthropicのインフラとNestioの間で完結し、コンテナ内のClaudeにMCPアクセストークンは
-- 渡らないため、既存のattachmentsRoute（セッションCookie認証）を直接curlで叩けない（改修17回目）。
-- create_attachment_uploadツールが発行するワンタイムアップロードトークン専用の管理テーブル。
-- 特定のsha256（バイト列）にひも付いた1回使い切りの用途限定トークンにすることで、漏洩しても
-- 任意ファイルの設置には使えないようにする。平文は保存せずハッシュのみ保存する
-- （oauth_tokensと同じ方針）。docs/schema.sql（確定版DDL）は変更せず、後続マイグレーションで
-- 追加する（access_requests等と同じ方針）
CREATE TABLE attachment_upload_tokens (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type  TEXT    NOT NULL,
  owner_id    TEXT    NOT NULL,
  filename    TEXT    NOT NULL,
  sha256      TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL,
  CHECK (owner_type IN ('task','note'))
) STRICT;
CREATE INDEX idx_attachment_upload_tokens_expires ON attachment_upload_tokens(expires_at);
