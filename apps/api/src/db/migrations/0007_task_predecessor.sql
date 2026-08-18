-- タスクの軽量な依存関係（改修13回目 D7）：「AはBが終わってから着手する」という
-- 一方向の依存だけを表現する。ガントチャート等の重い機能は入れず、単一の先行タスクIDを
-- 持たせるだけに留める。docs/schema.sql（確定版DDL）は変更せず、後続マイグレーションで追加。
-- 先行タスクが物理削除（GC）されたら参照は自動でNULLになる。論理削除（deleted_at）の間の
-- 扱いはアプリ側のロジック（「先行タスクなし」と同様に扱う）に委ねる。
ALTER TABLE tasks ADD COLUMN blocked_by_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_blocked_by ON tasks(blocked_by_task_id) WHERE blocked_by_task_id IS NOT NULL;
