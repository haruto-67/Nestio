# Open Questions

実装中に見つかった仕様の疑問点。実装で勝手に埋めず、判断とその理由をここに記録して先に進む。

---

## Phase 0

### 1. `user_settings` は `/sync` の同期対象テーブルに含めるか

- `docs/sync-protocol.md` 3章の pull レスポンス例（`changes` オブジェクト）には
  `folders / lists / tasks / tags / task_tags / notes / attachments / triggers` の8テーブルのみが列挙されており、`user_settings` は含まれていない
- 一方 `CLAUDE.md` 及び要件定義 3.13 には「キーマップは `user_settings.keymap_json` として `/sync` で全デバイスに同期する」と明記されている

**判断**：`user_settings` も pull/push の対象に含める（`packages/shared/src/schema/sync.ts` の `syncableTableSchema` に追加済み）。
`user_settings` は `id` を持たず PK が `user_id` 自体、かつ `deleted_at` を持たない（1ユーザー1行、論理削除の概念がない）ため、
他テーブルと同じ汎用ロジックには乗らず、`apps/api/src/sync/apply.ts` の `applyUserSettingsOp` で専用に扱う。
`op.id` にはクライアントが自分の `user_id` を指定する規約とした。Phase 1でキーマップ同期の実装と合わせて対応済み。

### 2. 同時刻更新のタイブレークを device_id 辞書順で実装できない

- `docs/sync-protocol.md` 4章：「`op.updated_at == 既存.updated_at` の場合、device_id の辞書順が大きい方を採用（決定的なタイブレーク）」
- `docs/schema.sql` の各同期対象テーブルには「その行を最後に書き込んだ device_id」を保持するカラムが無い（`applied_ops` にも table/id への紐付けが無い）ため、既存行の device_id を後から参照できない

**判断**：`apps/api/src/sync/apply.ts` では `op.updated_at >= 既存行.updated_at` なら常にopのfieldsを適用する、という簡略ルールにした（同時刻なら「後から処理された方が勝つ」）。
1リクエスト内は配列順、複数リクエストなら到着順で処理されるため、同じ入力列なら常に同じ結果になり「決定的に収束する」というテスト要件は満たす。ただし device_id 辞書順という仕様の字面とは異なる。
将来 device_id 基準が必須と判断したら、行に `last_write_device_id` 相当のカラムを追加するスキーマ変更が必要になる。

### 3. テーマ設定（`theme`）の同期 — 解決済み

`apps/web/src/state/useTheme.ts` を `user_settings.theme` 経由に統一した。未ログイン時や初回pull完了前は
`localStorage` → OS設定（`prefers-color-scheme`）の順にフォールバックする。

### 5. キーマップのカスタマイズ対象から「G→T」と優先度の1〜4キーを除外

要件定義 3.13 は「割り当ては設定画面で変更でき」「競合する割り当ては設定画面で警告する」とだけ規定しており、
全キーが1action-1keyの単純な対応になる前提までは明記していない。
**判断**：`apps/web/src/lib/keymap.ts` の `KEYMAP_ACTIONS` は1操作=1キー文字列のシンプルなマップとして実装した。
「今日」へ（`G`→`T`の2ストローク）と優先度変更（`1`〜`4`の4キー1操作）はこの形に素直に乗らないため、
カスタマイズ対象外・固定ショートカットのままとした（`apps/web/src/features/keyboard/useKeyboardShortcuts.ts`）。
将来ここもカスタマイズ可能にするなら、キーマップの値を配列や複合ステップに対応する形へスキーマ変更が必要になる。

### 6. PWAアイコンは仮のSVGプレースホルダ

`docs/manual-setup.md` G章の通り、確定アイコン（Canva `https://www.canva.com/d/3-dI-GIjYx1e-ML`）からのPNG書き出し（192/512の通常・マスカブル版、apple-touch-icon 180px、favicon.ico）は
Claude Codeでは行えない作業として元々ユーザー側のタスクに分類されている。
**判断**：Phase 2ではPWA化の技術基盤（manifest・Service Worker・オフラインシェル）を優先し、
`apps/web/public/icons/icon.svg` に巣+卵モチーフの簡易SVGを1枚だけ置いて `manifest.webmanifest` から `purpose: "any"` で参照した。
iOSの `apple-touch-icon` はSVGを認識しないため、実機のホーム画面追加では正式なPNG書き出しが必要
（`docs/manual-setup.md` G章の作業は未完了のまま）。Phase 6でCanvaからの書き出し後にこのSVGを差し替える。

### 7. `full_resync_required` はクライアント側ハンドリングのみ実装済み、サーバー側の判定はPhase 6待ち

`docs/sync-protocol.md` 6章：「`since` がサーバーのGC済み境界より古い場合、サーバーは `full_resync_required: true` を返す」。
この判定には「30日以上前のtombstoneをGCした境界」の情報が必要だが、そのGCワーカー自体が `docs/phases.md` Phase 6のタスクであり、
`sync_state` にも「境界seq」を保持するカラムが無い。
**判断**：Phase 2では `apps/web/src/sync/engine.ts` の `pullLoop` にクライアント側の対応（`full_resync_required: true` を
受け取ったらローカルDBを破棄してsince=0からやり直す、outboxは保持）のみ実装した。
サーバー側で実際に `full_resync_required: true` を返す判定ロジック（`apps/api/src/sync/pull.ts`）はPhase 6で
GCワーカーと一緒に実装する（境界seqをどこかに記録する必要がある）。

### 8. `tasks.rrule` に DTSTART を含めて保存する

`docs/schema.sql` のコメントは `rrule` を「RFC 5545 の RRULE 文字列」とだけ説明しており、DTSTARTの保持方法は明記されていない。
「遅れて完了しても次回期限は元の予定日基準（dtstartをズラさない）」を実現するには、繰り返しの起点（最初の予定日）をどこかに固定して覚えておく必要がある。
**判断**：`apps/web/src/lib/recurrence.ts` で `tasks.rrule` に `"DTSTART:...\nRRULE:..."` の複合文字列を保存する設計にした。
繰り返し設定時の現在の `due_at`/`due_date` をDTSTARTとして焼き込み、以後はそのDTSTARTを基準に `rrule.after(now, false)` で
「今日以降の直近1件」を計算する（何日サボっても1回のafter()呼び出しで済むため過去分は溜まらない）。
Phase 5のICSフィード出力時は `rrule` カラムの値をそのまま `RRULE:` 行に使う想定だったが、DTSTART込みの文字列になっているため、
ICS出力時はDTSTART行とRRULE行を分離するか、そのまま両方出力するかの実装調整が必要（Phase 5で対応）。

### 4. URLルーティングを実装していない

`docs/phases.md` Phase 1に「React 側の骨組み：2 ペインレイアウト、ルーティング、ダーク / ライト切替」とあるが、
要件定義・API仕様にURLroutingの詳細仕様（各ビューのURL形式など）が無い。
**判断**：Phase 1では `apps/web/src/App.tsx` の `useState<ViewSelection>` でビュー切り替えのみ実装し、
URL（`history`/`react-router` 等）とは連動させていない。そのため現状はブラウザの戻る/進む・リンク共有で
特定のリスト/タスクへ直接遷移できない。将来必要になった時点で `react-router-dom` 等の追加を検討する
（現時点で追加すると要件のないルーティング設計を先取りすることになるため見送った）。
