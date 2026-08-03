# Open Questions

実装中に見つかった仕様の疑問点。実装で勝手に埋めず、判断とその理由をここに記録して先に進む。

---

## Phase 0

### 1. `user_settings` は `/sync` の同期対象テーブルに含めるか

- `docs/sync-protocol.md` 3章の pull レスポンス例（`changes` オブジェクト）には
  `folders / lists / tasks / tags / task_tags / notes / attachments / triggers` の8テーブルのみが列挙されており、`user_settings` は含まれていない
- 一方 `CLAUDE.md` 及び要件定義 3.13 には「キーマップは `user_settings.keymap_json` として `/sync` で全デバイスに同期する」と明記されている

**判断**：`user_settings` も pull/push の対象に含める（`packages/shared/src/schema/sync.ts` の `syncableTableSchema` に追加済み）。
`user_settings` は `deleted_at` を持たない（1ユーザー1行、論理削除の概念がない）ため、削除opは発生しない前提で実装する。

Phase 2（実際に pull/push を実装する段階）で矛盾が出たら本項目を更新する。
