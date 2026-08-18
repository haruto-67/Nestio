-- カレンダー購読URLに名前を付けられるようにする（改修15回目：どのカレンダーアプリに
-- 登録したURLか分からなくなるという指摘への対応）。docs/schema.sql（確定版DDL）は
-- 変更せず、後続マイグレーションで追加する方針（0002_gc_boundary等と同じ）。
ALTER TABLE calendar_feeds ADD COLUMN name TEXT NOT NULL DEFAULT '';
