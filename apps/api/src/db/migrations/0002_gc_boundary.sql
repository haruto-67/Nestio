-- docs/sync-protocol.md 6章の full_resync_required 判定に使う「GC済み境界seq」。
-- GCワーカーがtombstoneを物理削除する際、そのユーザーの削除行の最大seqをここに書き込む。
-- since < gc_boundary_seq のクライアントは取りこぼしの可能性があるためフル再同期させる。
-- docs/open-questions.md 項目7参照。docs/schema.sql（確定版DDL）は変更せず、後続マイグレーションで追加する。
ALTER TABLE sync_state ADD COLUMN gc_boundary_seq INTEGER NOT NULL DEFAULT 0;
