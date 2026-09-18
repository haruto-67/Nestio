-- 「ナレッジ」機能（改修24回目）：タスク/メモに並ぶ第3のエンティティ。
-- 設計判断・調査ログ・プロジェクト仕様・人物/環境情報など永続的な知識を保持する。
-- [[タイトル]] によるノート間リンクとバックリンクのため knowledge_links を別テーブルで持つ。
-- to_title で未解決リンク（まだ存在しないノートへのリンク）も保持し、対象ノート作成時に
-- to_id を解決する想定（解決ロジックは別サブタスクで実装）。
-- 詳細はメモ「Nestio改修24回目 要件定義 — ナレッジ機能 & MCP高速化」を参照

CREATE TABLE knowledge (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  -- 1行要約。MCPの索引レスポンスでは本文の代わりにこれを返す
  description TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL DEFAULT '',
  -- 'profile' | 'project' | 'topic' | 'person'
  category    TEXT    NOT NULL DEFAULT 'topic',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  seq         INTEGER NOT NULL,
  CHECK (category IN ('profile','project','topic','person'))
) STRICT;
CREATE INDEX idx_knowledge_sync ON knowledge(user_id, seq);
-- titleは[[リンク]]解決のキーなのでユーザー内で一意。論理削除後はタイトルの再利用を許可する
CREATE UNIQUE INDEX idx_knowledge_title ON knowledge(user_id, title) WHERE deleted_at IS NULL;

-- タグは既存のtagsテーブルをタスクと共用する（プロジェクト単位で横断できるようにする）
CREATE TABLE knowledge_tags (
  id           TEXT    NOT NULL PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  knowledge_id TEXT    NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
  tag_id       TEXT    NOT NULL REFERENCES tags(id)      ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  seq          INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX idx_knowledge_tags_uniq ON knowledge_tags(knowledge_id, tag_id);
CREATE INDEX idx_knowledge_tags_sync ON knowledge_tags(user_id, seq);
CREATE INDEX idx_knowledge_tags_tag  ON knowledge_tags(tag_id);

CREATE TABLE knowledge_links (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_id    TEXT    NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
  to_title   TEXT    NOT NULL,
  to_id      TEXT    REFERENCES knowledge(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL
) STRICT;
-- 同じノートから同じタイトルへのリンクは1行に集約する。解除後の再リンクは許可する
CREATE UNIQUE INDEX idx_knowledge_links_uniq  ON knowledge_links(from_id, to_title) WHERE deleted_at IS NULL;
CREATE INDEX idx_knowledge_links_sync  ON knowledge_links(user_id, seq);
CREATE INDEX idx_knowledge_links_to    ON knowledge_links(to_id);
-- to_id解決（あるタイトルのノートが新規作成された時に、そのタイトルを指す未解決リンクを探す）用
CREATE INDEX idx_knowledge_links_title ON knowledge_links(user_id, to_title);

-- 全文検索。既存のtasks_fts/notes_fts と同じtrigram方式（3文字未満はAPI側でLIKEにフォールバック）
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title, description, body,
  content='knowledge', content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER knowledge_fts_ai AFTER INSERT ON knowledge BEGIN
  INSERT INTO knowledge_fts(rowid, title, description, body)
    VALUES (new.rowid, new.title, new.description, new.body);
END;
CREATE TRIGGER knowledge_fts_ad AFTER DELETE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, description, body)
    VALUES('delete', old.rowid, old.title, old.description, old.body);
END;
CREATE TRIGGER knowledge_fts_au AFTER UPDATE ON knowledge BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, description, body)
    VALUES('delete', old.rowid, old.title, old.description, old.body);
  INSERT INTO knowledge_fts(rowid, title, description, body)
    VALUES (new.rowid, new.title, new.description, new.body);
END;
