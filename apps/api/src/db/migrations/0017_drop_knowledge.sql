-- 改修25回目：ナレッジの保存先をObsidian形式のVault（<VAULT_DIR>/<user_id>/配下のmd）へ移したため、
-- 旧ナレッジのテーブルを撤去する（docs/vault-spec.md 9章）。撤去前に本番DB全体と旧ナレッジの
-- JSONを /var/lib/nestio/backup/ に保存済み（2026-09-24、ユーザー承認済み）。
-- 同期クライアントのoutboxに残ったknowledge/knowledge_tagsのopは、SYNC_TABLESから外したことで
-- サーバーがop単位でvalidation_failedとして拒否する。

DROP TRIGGER IF EXISTS knowledge_fts_ai;
DROP TRIGGER IF EXISTS knowledge_fts_ad;
DROP TRIGGER IF EXISTS knowledge_fts_au;
DROP TABLE IF EXISTS knowledge_fts;
DROP TABLE IF EXISTS knowledge_links;
DROP TABLE IF EXISTS knowledge_tags;
DROP TABLE IF EXISTS knowledge;
