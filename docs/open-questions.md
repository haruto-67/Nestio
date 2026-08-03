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

### 2. 同時刻更新のタイブレークを device_id 辞書順で実装できない

- `docs/sync-protocol.md` 4章：「`op.updated_at == 既存.updated_at` の場合、device_id の辞書順が大きい方を採用（決定的なタイブレーク）」
- `docs/schema.sql` の各同期対象テーブルには「その行を最後に書き込んだ device_id」を保持するカラムが無い（`applied_ops` にも table/id への紐付けが無い）ため、既存行の device_id を後から参照できない

**判断**：`apps/api/src/sync/apply.ts` では `op.updated_at >= 既存行.updated_at` なら常にopのfieldsを適用する、という簡略ルールにした（同時刻なら「後から処理された方が勝つ」）。
1リクエスト内は配列順、複数リクエストなら到着順で処理されるため、同じ入力列なら常に同じ結果になり「決定的に収束する」というテスト要件は満たす。ただし device_id 辞書順という仕様の字面とは異なる。
将来 device_id 基準が必須と判断したら、行に `last_write_device_id` 相当のカラムを追加するスキーマ変更が必要になる。
