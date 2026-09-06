-- 「共有リスト」機能（改修22回目）：リスト単位で他ユーザーに編集権限を付与する。
-- 詳細な設計はdocs/sync-protocol.md 10章を参照。
-- list_sharesとshared_row_changesはどちらも/sync/pushの対象外（seqを持たない、
-- Dexieへは同期しない）。招待CRUDは専用APIで完結し、複製の仕組みだけがtasks/listsの
-- 同期(pull)に影響する

-- リストの共有関係（招待・承諾管理）。招待は既存ユーザーのメールアドレス指定のみ
CREATE TABLE list_shares (
  id                TEXT    NOT NULL PRIMARY KEY,
  list_id           TEXT    NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  owner_user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_user_id   TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_email     TEXT    NOT NULL,
  -- 'pending' | 'accepted'
  status            TEXT    NOT NULL DEFAULT 'pending',
  created_at        INTEGER NOT NULL,
  accepted_at       INTEGER,
  deleted_at        INTEGER,
  CHECK (status IN ('pending','accepted'))
) STRICT;
-- 同じリストへの重複招待を防ぐ（解除(deleted_at)後の再招待は許可するので部分インデックス）
CREATE UNIQUE INDEX idx_list_shares_active ON list_shares(list_id, invited_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_list_shares_invited ON list_shares(invited_user_id, status, deleted_at);
CREATE INDEX idx_list_shares_owner ON list_shares(owner_user_id, list_id, deleted_at);

-- owner側のtasks/lists変更を、共有されている各editor自身のseq系列へ複製するためのポインタ。
-- 実データはtasks/listsテーブルにそのまま(owner_user_idのまま)残り、この行は
-- 「このeditorにもこの時点で見せる」という通知専用の薄いレプリケーションログ
CREATE TABLE shared_row_changes (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'tasks' | 'lists'
  table_name  TEXT    NOT NULL,
  row_id      TEXT    NOT NULL,
  -- user_id(editor)自身のsync_state.last_seq系列で採番した値
  seq         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  CHECK (table_name IN ('tasks','lists'))
) STRICT;
CREATE INDEX idx_shared_row_changes_sync ON shared_row_changes(user_id, table_name, seq);
CREATE INDEX idx_shared_row_changes_row  ON shared_row_changes(table_name, row_id);
