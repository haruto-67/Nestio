-- MCPからの読み出し（get_attachment）は1MB超の添付でbase64を返せないため、書き込み側
-- （attachment_upload_tokens）と対称なワンタイムダウンロードトークンを追加する
-- （改修19回目：Nestioメモ「MCP画像アップロード 現行仕様まとめ」の未対応事項B・案2）。
-- 既にDB上に存在するattachmentのsha256を指定して発行するだけなので、owner_type/owner_id/
-- filenameは持たない。平文は保存せずハッシュのみ保存する（oauth_tokensと同じ方針）
CREATE TABLE attachment_download_tokens (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sha256      TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_attachment_download_tokens_expires ON attachment_download_tokens(expires_at);
