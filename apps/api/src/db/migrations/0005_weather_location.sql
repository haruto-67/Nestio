-- Hatchの天気連動（改修13回目 D6）用に、ユーザーが天気予報を取得する地点（緯度経度）を
-- 保存するカラムを追加する。docs/schema.sql（確定版DDL）は変更せず、後続マイグレーションで
-- 追加する方針（0002_gc_boundary・0003_task_completionsと同じ）。
-- 値はJSON文字列 { lat: number, lon: number, name: string }。未設定なら '{}'
ALTER TABLE user_settings ADD COLUMN weather_location_json TEXT NOT NULL DEFAULT '{}';
