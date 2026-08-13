-- 誰でもGoogleログインでアカウントを作れてしまう状態をやめ、管理者(ADMIN_EMAIL)の承認を
-- 経てはじめてusersに本登録される形にする（改修10回目）。docs/schema.sql（確定版DDL）は
-- 変更せず、後続マイグレーションで追加する方針（gc_boundary_seq・task_completionsと同じ）。
CREATE TABLE access_requests (
  id           TEXT    NOT NULL PRIMARY KEY,
  google_sub   TEXT    NOT NULL UNIQUE,
  email        TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  avatar_url   TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending',
  requested_at INTEGER NOT NULL,
  decided_at   INTEGER,
  CHECK (status IN ('pending', 'approved', 'rejected'))
) STRICT;
CREATE INDEX idx_access_requests_status ON access_requests(status);
