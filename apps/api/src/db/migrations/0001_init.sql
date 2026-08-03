-- Nestio schema (SQLite 3.37+)
-- 方針:
--   * すべて STRICT テーブル（型宣言が無視されるのを防ぐ）
--   * ID は TEXT。クライアントが UUIDv7 を採番する（オフラインで作成できる必要があるため）
--   * 時刻は INTEGER（Unix epoch ミリ秒, UTC）。表示時に Asia/Tokyo へ変換
--   * 終日タスクの日付のみ TEXT 'YYYY-MM-DD'（タイムゾーン変換の対象外）
--   * 同期対象テーブルは必ず updated_at / deleted_at / seq を持つ
--   * seq はサーバーが採番する単調増加値。同期のカーソルに使う

-- PRAGMA群（journal_mode / busy_timeout / foreign_keys / synchronous）は
-- 接続確立時に db/client.ts の createDbConnection で設定する。
-- WAL等の変更はトランザクション内から行えないため、マイグレーションSQLには含めない。

-- ============================================================
-- ユーザー / 認証
-- ============================================================

CREATE TABLE users (
  id           TEXT    NOT NULL PRIMARY KEY,
  google_sub   TEXT    NOT NULL UNIQUE,
  email        TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  avatar_url   TEXT,
  created_at   INTEGER NOT NULL
) STRICT;

-- 同期カーソルの採番元。1 ユーザー 1 行
CREATE TABLE sync_state (
  user_id  TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seq INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE devices (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,
  last_seen  INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_devices_user ON devices(user_id);

CREATE TABLE sessions (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  TEXT    REFERENCES devices(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ============================================================
-- タスク関連
-- ============================================================

CREATE TABLE folders (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  sort_order REAL    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_folders_sync ON folders(user_id, seq);

CREATE TABLE lists (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  TEXT    REFERENCES folders(id) ON DELETE SET NULL,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#888888',
  -- 'custom' | 'due' | 'priority' | 'name'
  sort_mode  TEXT    NOT NULL DEFAULT 'custom',
  sort_order REAL    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL,
  CHECK (sort_mode IN ('custom','due','priority','name'))
) STRICT;
CREATE INDEX idx_lists_sync   ON lists(user_id, seq);
CREATE INDEX idx_lists_folder ON lists(user_id, folder_id);

CREATE TABLE tasks (
  id           TEXT    NOT NULL PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id      TEXT    NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  parent_id    TEXT    REFERENCES tasks(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  note         TEXT    NOT NULL DEFAULT '',
  -- 0=なし 1=低 2=中 3=高
  priority     INTEGER NOT NULL DEFAULT 0,
  -- 時刻ありの期限（epoch ms, UTC）。終日タスクは NULL
  due_at       INTEGER,
  -- 終日タスクの日付 'YYYY-MM-DD'。時刻ありの場合は NULL
  due_date     TEXT,
  -- RFC 5545 の RRULE 文字列。繰り返さない場合は NULL
  rrule        TEXT,
  completed_at INTEGER,
  sort_order   REAL    NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  seq          INTEGER NOT NULL,
  CHECK (priority BETWEEN 0 AND 3),
  -- due_at と due_date は排他
  CHECK (due_at IS NULL OR due_date IS NULL)
) STRICT;
CREATE INDEX idx_tasks_sync     ON tasks(user_id, seq);
CREATE INDEX idx_tasks_list     ON tasks(user_id, list_id, deleted_at);
CREATE INDEX idx_tasks_parent   ON tasks(parent_id);
CREATE INDEX idx_tasks_due      ON tasks(user_id, due_at)   WHERE completed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_tasks_due_date ON tasks(user_id, due_date) WHERE completed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_tasks_rrule    ON tasks(user_id) WHERE rrule IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE tags (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#888888',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_tags_sync ON tags(user_id, seq);

-- 中間テーブルも同期対象なので独立した id と論理削除を持たせる
CREATE TABLE task_tags (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id    TEXT    NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id     TEXT    NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX idx_task_tags_uniq ON task_tags(task_id, tag_id);
CREATE INDEX idx_task_tags_sync ON task_tags(user_id, seq);
CREATE INDEX idx_task_tags_tag  ON task_tags(tag_id);

-- ============================================================
-- メモ
-- ============================================================

CREATE TABLE notes (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL DEFAULT '',
  body       TEXT    NOT NULL DEFAULT '',
  color      TEXT    NOT NULL DEFAULT '#FFF7C0',
  pinned     INTEGER NOT NULL DEFAULT 0,
  sort_order REAL    NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL,
  CHECK (pinned IN (0,1))
) STRICT;
CREATE INDEX idx_notes_sync ON notes(user_id, seq);

-- ============================================================
-- 添付ファイル
-- ============================================================

CREATE TABLE attachments (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'task' | 'note'
  owner_type TEXT    NOT NULL,
  owner_id   TEXT    NOT NULL,
  -- 実体ファイル名（content-addressed）
  sha256     TEXT    NOT NULL,
  filename   TEXT    NOT NULL,
  mime       TEXT    NOT NULL,
  bytes      INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL,
  CHECK (owner_type IN ('task','note'))
) STRICT;
CREATE INDEX idx_attachments_sync   ON attachments(user_id, seq);
CREATE INDEX idx_attachments_owner  ON attachments(user_id, owner_type, owner_id, deleted_at);
CREATE INDEX idx_attachments_sha    ON attachments(sha256);

-- ============================================================
-- 通知
-- ============================================================

CREATE TABLE push_subscriptions (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  TEXT    REFERENCES devices(id) ON DELETE CASCADE,
  endpoint   TEXT    NOT NULL UNIQUE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);

-- 期限リマインダーとポモドーロ終了通知の予約
CREATE TABLE scheduled_pushes (
  id           TEXT    NOT NULL PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'due_reminder' | 'pomodoro'
  kind         TEXT    NOT NULL,
  task_id      TEXT    REFERENCES tasks(id) ON DELETE CASCADE,
  fire_at      INTEGER NOT NULL,
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL DEFAULT '',
  sent_at      INTEGER,
  canceled_at  INTEGER,
  created_at   INTEGER NOT NULL,
  CHECK (kind IN ('due_reminder','pomodoro'))
) STRICT;
CREATE INDEX idx_sched_pending ON scheduled_pushes(fire_at)
  WHERE sent_at IS NULL AND canceled_at IS NULL;

-- ============================================================
-- カレンダー（ICS フィード）
-- ============================================================

CREATE TABLE calendar_feeds (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 推測不能なトークン。URL に含める
  token      TEXT    NOT NULL UNIQUE,
  -- NULL なら全リスト対象
  list_id    TEXT    REFERENCES lists(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

-- ============================================================
-- Hatch（トリガー）
-- ============================================================

CREATE TABLE triggers (
  id             TEXT    NOT NULL PRIMARY KEY,
  user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  -- 'task_completed' | 'list_all_completed' | 'due_soon'
  -- | 'overdue' | 'task_created' | 'recurrence_spawned' | 'schedule'
  event          TEXT    NOT NULL,
  -- 発火条件（list_id / tag_id / priority / offset_minutes / cron など）
  condition_json TEXT    NOT NULL DEFAULT '{}',
  -- ホワイトリストされたアクションキー
  action_key     TEXT    NOT NULL,
  params_json    TEXT    NOT NULL DEFAULT '{}',
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  seq            INTEGER NOT NULL,
  CHECK (enabled IN (0,1)),
  CHECK (event IN ('task_completed','list_all_completed','due_soon',
                   'overdue','task_created','recurrence_spawned','schedule'))
) STRICT;
CREATE INDEX idx_triggers_sync  ON triggers(user_id, seq);
CREATE INDEX idx_triggers_event ON triggers(user_id, event)
  WHERE enabled = 1 AND deleted_at IS NULL;

CREATE TABLE trigger_runs (
  id          TEXT    NOT NULL PRIMARY KEY,
  trigger_id  TEXT    NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout'
  status      TEXT    NOT NULL,
  subject_id  TEXT,
  attempt     INTEGER NOT NULL DEFAULT 0,
  output      TEXT    NOT NULL DEFAULT '',
  error       TEXT,
  started_at  INTEGER,
  finished_at INTEGER,
  created_at  INTEGER NOT NULL,
  CHECK (status IN ('queued','running','succeeded','failed','timeout'))
) STRICT;
CREATE INDEX idx_trigger_runs_queue ON trigger_runs(status, created_at);
CREATE INDEX idx_trigger_runs_user  ON trigger_runs(user_id, created_at);

-- ============================================================
-- 同期の冪等性台帳
-- ============================================================
-- クライアントの outbox 再送で同じ操作が二重適用されるのを防ぐ。
-- op_id はクライアントが操作ごとに採番する UUIDv7。

CREATE TABLE applied_ops (
  op_id      TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  applied_at INTEGER NOT NULL,
  result_seq INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_applied_ops_gc ON applied_ops(applied_at);

-- ============================================================
-- 全文検索（FTS5 / trigram）
-- ============================================================
-- trigram は 3 文字単位で索引を作るため、2 文字以下のクエリは
-- ヒットしない。API 側で 3 文字未満は LIKE にフォールバックすること。

CREATE VIRTUAL TABLE tasks_fts USING fts5(
  title, note,
  content='tasks', content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER tasks_fts_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, note) VALUES (new.rowid, new.title, new.note);
END;
CREATE TRIGGER tasks_fts_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, note) VALUES('delete', old.rowid, old.title, old.note);
END;
CREATE TRIGGER tasks_fts_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, note) VALUES('delete', old.rowid, old.title, old.note);
  INSERT INTO tasks_fts(rowid, title, note) VALUES (new.rowid, new.title, new.note);
END;

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body,
  content='notes', content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER notes_fts_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER notes_fts_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', old.rowid, old.title, old.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

-- ============================================================
-- ユーザー設定（キーマップ・テーマなど）
-- 同期対象。1 ユーザー 1 行の KVS 的な使い方
-- ============================================================

CREATE TABLE user_settings (
  user_id     TEXT    NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- 'dark' | 'light'
  theme       TEXT    NOT NULL DEFAULT 'light',
  -- ショートカットのキーマップ（操作キー -> キー割り当ての JSON）
  keymap_json TEXT    NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  CHECK (theme IN ('dark','light'))
) STRICT;

-- ============================================================
-- MCP の OAuth（Nestio が簡易認可サーバーになる）
-- ============================================================

-- Claude 等のクライアント登録
CREATE TABLE oauth_clients (
  id            TEXT    NOT NULL PRIMARY KEY,
  user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  redirect_uris TEXT    NOT NULL,          -- JSON 配列
  created_at    INTEGER NOT NULL
) STRICT;

-- 発行済みアクセストークン。平文は保存せずハッシュのみ
CREATE TABLE oauth_tokens (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   TEXT    NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,     -- SHA-256 等のハッシュ
  -- スペース区切り。'read' / 'write'
  scope       TEXT    NOT NULL DEFAULT 'read',
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_oauth_tokens_user ON oauth_tokens(user_id);
