-- 習慣トラッキング（連続達成数=ストリーク表示）用の完了履歴ログ（改修5回目・
-- 改修4回目ブレインストーム案B「習慣トラッキング」）。繰り返しタスクは常に直近1件のみ表示され
-- 過去の完了履歴が残らないため、ストリーク計算専用の追記のみのログテーブルを別途持つ。
-- docs/schema.sql（確定版DDL）は変更せず、後続マイグレーションで追加する
-- （docs/open-questions.md 項目7のgc_boundary_seqと同じ方針）。
-- 同期対象（/sync）には含めない。サーバー内部の集計専用データのため、専用の読み取りAPI
-- （GET /api/v1/tasks/:id/streak）でのみ公開する。
CREATE TABLE task_completions (
  id           TEXT    NOT NULL PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id      TEXT    NOT NULL,
  completed_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_task_completions_task ON task_completions(task_id, completed_at);
