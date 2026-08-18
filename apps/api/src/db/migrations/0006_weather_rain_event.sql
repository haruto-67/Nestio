-- triggers.event の CHECK 制約に 'weather_rain'（改修13回目 D6：Hatchの発火条件を
-- 生活寄りに拡張）を追加する。SQLiteはCHECK制約をALTER TABLEで直接変更できないため、
-- テーブルを作り直す（docs/schema.sql確定版DDLは変更せず、後続マイグレーションで対応する方針）。
-- trigger_runs.trigger_id は triggers を参照するFKを持つため、triggersのRENAME時に
-- 自動でtrigger_runs側の参照定義がtriggers_oldへ書き換わる。そのままtriggers_oldを
-- DROPすると参照が宙に浮くため、trigger_runsも作り直して新しいtriggersを指す形に揃える。

ALTER TABLE triggers RENAME TO triggers_old;

CREATE TABLE triggers (
  id             TEXT    NOT NULL PRIMARY KEY,
  user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  event          TEXT    NOT NULL,
  condition_json TEXT    NOT NULL DEFAULT '{}',
  action_key     TEXT    NOT NULL,
  params_json    TEXT    NOT NULL DEFAULT '{}',
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,
  seq            INTEGER NOT NULL,
  CHECK (enabled IN (0,1)),
  CHECK (event IN ('task_completed','list_all_completed','due_soon',
                   'overdue','task_created','recurrence_spawned','schedule','weather_rain'))
) STRICT;

INSERT INTO triggers SELECT * FROM triggers_old;

ALTER TABLE trigger_runs RENAME TO trigger_runs_old;

CREATE TABLE trigger_runs (
  id          TEXT    NOT NULL PRIMARY KEY,
  trigger_id  TEXT    NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

INSERT INTO trigger_runs SELECT * FROM trigger_runs_old;

DROP TABLE trigger_runs_old;
DROP TABLE triggers_old;

CREATE INDEX idx_triggers_sync  ON triggers(user_id, seq);
CREATE INDEX idx_triggers_event ON triggers(user_id, event)
  WHERE enabled = 1 AND deleted_at IS NULL;
CREATE INDEX idx_trigger_runs_queue ON trigger_runs(status, created_at);
CREATE INDEX idx_trigger_runs_user  ON trigger_runs(user_id, created_at);
