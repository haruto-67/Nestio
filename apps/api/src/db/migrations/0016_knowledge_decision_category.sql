-- 記憶規約ナレッジ（改修24回目フォローアップ）：categoryに'decision'（複数の選択肢から
-- 1つを選んだ判断とその理由。後から再構築できない情報のため独立カテゴリにする）を追加する。
-- SQLiteはCHECK制約を直接ALTERできないため、knowledgeテーブルを作り直す
-- （0006_weather_rain_event.sqlと同じ手法）。
--
-- knowledge_fts（外部コンテンツFTS5、content_rowid='rowid'）はknowledgeのrowidと
-- 対応させる必要があるため、通常の INSERT ... SELECT * ではrowidが振り直されて
-- ずれてしまう。rowidを明示的に指定してコピーし、FTS本体・トリガーも作り直して揃える。
--
-- knowledge_tags.knowledge_id / knowledge_links.from_id・to_id は knowledge を参照する
-- FKを持つため、ALTER TABLE knowledge RENAME TO knowledge_old の時点でSQLiteが自動的に
-- それらのFK定義を"knowledge_old"へ書き換えてしまう（0006_weather_rain_event.sqlの
-- trigger_runsと同じ罠）。knowledge_oldをDROPした後にknowledge_tags/knowledge_linksへ
-- INSERTしようとすると「no such table: main.knowledge_old」でFK検証が失敗するため、
-- この2テーブルも新しいknowledgeを指す形で作り直す。

DROP TRIGGER knowledge_fts_ai;
DROP TRIGGER knowledge_fts_ad;
DROP TRIGGER knowledge_fts_au;
DROP TABLE knowledge_fts;

ALTER TABLE knowledge RENAME TO knowledge_old;

CREATE TABLE knowledge (
  id          TEXT    NOT NULL PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  body        TEXT    NOT NULL DEFAULT '',
  -- 'profile' | 'project' | 'topic' | 'person' | 'decision'
  category    TEXT    NOT NULL DEFAULT 'topic',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  seq         INTEGER NOT NULL,
  CHECK (category IN ('profile','project','topic','person','decision'))
) STRICT;

INSERT INTO knowledge (rowid, id, user_id, title, description, body, category, created_at, updated_at, deleted_at, seq)
  SELECT rowid, id, user_id, title, description, body, category, created_at, updated_at, deleted_at, seq
  FROM knowledge_old;

DROP TABLE knowledge_old;

CREATE INDEX idx_knowledge_sync ON knowledge(user_id, seq);
CREATE UNIQUE INDEX idx_knowledge_title ON knowledge(user_id, title) WHERE deleted_at IS NULL;

-- knowledge_tags・knowledge_links を、新しいknowledgeを指す形で作り直す
ALTER TABLE knowledge_tags RENAME TO knowledge_tags_old;

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
INSERT INTO knowledge_tags SELECT * FROM knowledge_tags_old;
DROP TABLE knowledge_tags_old;

CREATE UNIQUE INDEX idx_knowledge_tags_uniq ON knowledge_tags(knowledge_id, tag_id);
CREATE INDEX idx_knowledge_tags_sync ON knowledge_tags(user_id, seq);
CREATE INDEX idx_knowledge_tags_tag  ON knowledge_tags(tag_id);

ALTER TABLE knowledge_links RENAME TO knowledge_links_old;

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
INSERT INTO knowledge_links SELECT * FROM knowledge_links_old;
DROP TABLE knowledge_links_old;

CREATE UNIQUE INDEX idx_knowledge_links_uniq  ON knowledge_links(from_id, to_title) WHERE deleted_at IS NULL;
CREATE INDEX idx_knowledge_links_sync  ON knowledge_links(user_id, seq);
CREATE INDEX idx_knowledge_links_to    ON knowledge_links(to_id);
CREATE INDEX idx_knowledge_links_title ON knowledge_links(user_id, to_title);

CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title, description, body,
  content='knowledge', content_rowid='rowid',
  tokenize='trigram'
);
INSERT INTO knowledge_fts(rowid, title, description, body)
  SELECT rowid, title, description, body FROM knowledge;

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
