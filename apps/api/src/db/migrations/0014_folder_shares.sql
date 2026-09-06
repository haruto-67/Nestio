-- 「フォルダ共有」機能（改修22回目フォローアップ）：list_sharesと対称の、フォルダ単位の
-- 共有関係。フォルダを共有すると、以後そのフォルダに追加/移動されたリストも自動的に
-- 共有対象になる（動的共有）。判定・複製ロジックの詳細はapps/api/src/shares/を参照

CREATE TABLE folder_shares (
  id                TEXT    NOT NULL PRIMARY KEY,
  folder_id         TEXT    NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
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
CREATE UNIQUE INDEX idx_folder_shares_active ON folder_shares(folder_id, invited_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_folder_shares_invited ON folder_shares(invited_user_id, status, deleted_at);
CREATE INDEX idx_folder_shares_owner ON folder_shares(owner_user_id, folder_id, deleted_at);

-- shared_row_changes.table_nameへ'folders'を追加できるようCHECK制約を緩める。
-- SQLiteはCHECK制約を直接ALTERできないためテーブルを作り直す
CREATE TABLE shared_row_changes_new (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_name  TEXT    NOT NULL,
  row_id      TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  CHECK (table_name IN ('tasks','lists','folders'))
) STRICT;
INSERT INTO shared_row_changes_new SELECT * FROM shared_row_changes;
DROP TABLE shared_row_changes;
ALTER TABLE shared_row_changes_new RENAME TO shared_row_changes;
CREATE INDEX idx_shared_row_changes_sync ON shared_row_changes(user_id, table_name, seq);
CREATE INDEX idx_shared_row_changes_row  ON shared_row_changes(table_name, row_id);
