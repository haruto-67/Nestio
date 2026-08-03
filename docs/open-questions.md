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

### 7. `full_resync_required` — Phase 6で解決済み

`docs/sync-protocol.md` 6章：「`since` がサーバーのGC済み境界より古い場合、サーバーは `full_resync_required: true` を返す」。
この判定には「30日以上前のtombstoneをGCした境界」の情報が必要だが、`docs/schema.sql` の `sync_state` には
それを保持するカラムが無かった（`docs/schema.sql` は確定版DDLとして勝手に変更しない方針のため）。
**判断**：`docs/schema.sql` 自体は変更せず、`apps/api/src/db/migrations/0002_gc_boundary.sql` で
`sync_state.gc_boundary_seq` を追加するマイグレーションを足した。GCワーカー（`apps/api/src/gc/tombstones.ts`）が
tombstoneを物理削除する際、そのユーザーの削除行の最大seqを `raiseGcBoundarySeq` で記録し、
`apps/api/src/sync/pull.ts` は `since < gc_boundary_seq` なら `full_resync_required: true` を返す。
添付ファイルの実体GC（「参照ゼロになってから30日」）は、tombstoneを30日保持してから物理削除する
既存の仕組みと組み合わせることで追加の状態を持たずに実現した（`apps/api/src/gc/attachments.ts` のコメント参照）。

### 8. `tasks.rrule` に DTSTART を含めて保存する

`docs/schema.sql` のコメントは `rrule` を「RFC 5545 の RRULE 文字列」とだけ説明しており、DTSTARTの保持方法は明記されていない。
「遅れて完了しても次回期限は元の予定日基準（dtstartをズラさない）」を実現するには、繰り返しの起点（最初の予定日）をどこかに固定して覚えておく必要がある。
**判断**：`apps/web/src/lib/recurrence.ts` で `tasks.rrule` に `"DTSTART:...\nRRULE:..."` の複合文字列を保存する設計にした。
繰り返し設定時の現在の `due_at`/`due_date` をDTSTARTとして焼き込み、以後はそのDTSTARTを基準に `rrule.after(now, false)` で
「今日以降の直近1件」を計算する（何日サボっても1回のafter()呼び出しで済むため過去分は溜まらない）。
Phase 5のICSフィード出力時は `rrule` カラムの値をそのまま `RRULE:` 行に使う想定だったが、DTSTART込みの文字列になっているため、
ICS出力時はDTSTART行とRRULE行を分離するか、そのまま両方出力するかの実装調整が必要（Phase 5で対応）。

### 9. 添付の総容量チェックは `POST /attachments` のみ、`/sync/push` 側では未実装

`docs/sync-protocol.md` 5章のバリデーション表に「添付の総容量：ユーザー上限を超えたらreject」とあり、
これは `/sync/push` での `attachments` upsert時のバリデーションとしても読める。
**判断**：実ディスク使用量を直接制限できる `POST /api/v1/attachments/:sha256`（実体アップロード時）でのみ
容量チェックを実装した（`apps/api/src/routes/attachments.ts`）。`/sync/push` 側で `attachments.bytes`
フィールドの二重チェックは行っていない（`apps/api/src/sync/apply.ts` の `applyOneOp` は現状 `env` を
受け取らない設計で、容量上限値にアクセスするには関数シグネチャの変更が必要なため、実装コストと
得られる安全性の比較でPOST側のチェックのみに留めた）。実体を伴わないメタデータ単体の不正なbytes値送信で
容量上限を回避できる可能性は残るため、必要になれば `applyOneOp` に `env` を渡す形に拡張する。

### 10. 添付プレビューのタイミング問題 — 解決済み

当初 `apps/web/src/features/attachments/AttachmentList.tsx` は常に `GET /attachments/{sha256}` のURLを
`<img src>` に指定するだけの実装にしていたが、実機確認で `pushLoop`（`apps/web/src/sync/engine.ts`）による
実体アップロードが完了する前にブラウザが画像を取得しようとして404になる問題が頻発することが分かった
（オフライン時に限らず、オンラインでも作成直後は必ず発生する）。
**対応**：`db/queries.ts` に `usePendingAttachmentBlob(sha256)` を追加し、`pendingAttachmentBlobs` に
Blobが残っている間は `URL.createObjectURL` でローカルプレビューを表示、アップロード完了後（Blobが
削除された後）にサーバーURLへ自動的に切り替わるようにした（`AttachmentThumbnail` コンポーネント）。

### 11. MCPのOAuthクライアント動的登録時、`oauth_clients.user_id` をどう埋めるか

`docs/schema.sql` の `oauth_clients` は `user_id NOT NULL REFERENCES users(id)` だが、OAuth 2.1の
Dynamic Client Registration（RFC 7591、`POST /mcp/oauth/register`）は仕様上クライアントソフトウェア自身が
エンドユーザーの操作と非同期に呼ぶもので、登録時点ではまだ「どのユーザーか」が分からない
（ユーザーが認可するのはその後の `GET /mcp/oauth/authorize` の段階）。
**判断**：Nestioは要件定義2章の通り「1ユーザー・複数デバイス」専用アプリなので、
`POST /mcp/oauth/register` 時点ではDB内の（唯一のはずの）ユーザーへ自動的に紐付ける
（`apps/api/src/mcp/clients.ts`）。複数ユーザー運用は想定しないためこれで問題ないが、
将来複数ユーザー対応する場合はスキーマ変更（`user_id` を nullable にするか、登録と認可を分離する）が必要になる。

### 12. 認可コードは `schema.sql` にテーブルが無いためメモリ内で管理する

`oauth_tokens` は発行済み「アクセストークン」のみを保持し、認可コード（数分で失効する一時的な値）を
保存するテーブルは `schema.sql` に存在しない。ここに新規テーブルを追加するのは
CLAUDE.md 絶対原則「`docs/schema.sql` は勝手に変更しない」に抵触するため避けた。
**判断**：認可コードは `apps/api/src/mcp/authorization-codes.ts` のメモリ内Mapで管理し、
TTL（10分）を超えたものは自動的に無効とする。サーバー再起動で認可コードは失われるが、
数分で失効する性質上、実用上の問題にはならない（再度 `/authorize` からやり直せばよい）。

### 13. MCP認可画面は未ログイン時にログインへ自動誘導しない

一般的なOAuth認可サーバーは、未ログインユーザーが `/authorize` に来た場合ログイン画面を挟んで
元のリクエストに戻す（return_to）フローを持つが、これを実装するには既存のGoogle OAuthフロー
（`apps/api/src/routes/auth.ts`、`oauth-flow-cookies.ts`）に return_to の受け渡しを追加する必要があり、
実装コストの割に得られる価値が小さいと判断した。
**判断**：`GET/POST /mcp/oauth/authorize` は `requireAuth` 必須とし、未ログインなら401を返すだけに留めた
（`apps/api/src/routes/mcp.ts`）。ユーザーは通常ブラウザで先にNestioにログイン済みの状態でMCP接続を
試みる想定のため、実用上の支障は小さいと判断。将来「未ログインのままMCP接続を開始する」体験が
必要になったらreturn_toを実装する。

### 14. Hatchの `recurrence_spawned` イベントは未実装

「繰り返しタスクの新規発生」を検知するには、rrule付きタスクの `due_at`/`due_date` 更新が
「次のoccurrenceへ進んだことによるもの」か「ユーザーの手動編集」かを区別する必要があるが、
Phase 3の実装（`apps/web/src/lib/recurrence.ts`）では繰り返し計算はクライアント側で行われ、
サーバーには通常の `tasks` upsert opとして届くため、両者を確実に区別する情報が無い。
**判断**：実装コストと確実性のバランスから `recurrence_spawned` イベントの検知は見送った。
`task_completed`・`list_all_completed`・`due_soon`・`overdue`・`task_created`・`schedule` の
6イベントを実装し、`docs/schema.sql` の `event` CHECK制約に `recurrence_spawned` 自体は残っている
（トリガー定義としては保存できるが、発火する仕組みが無い）。将来必要になれば、
サーバー側でrrule計算を肩代わりするか、クライアントが「これはrecurrence由来」と明示するフィールドを
追加する形で対応する。

### 4. URLルーティングを実装していない

`docs/phases.md` Phase 1に「React 側の骨組み：2 ペインレイアウト、ルーティング、ダーク / ライト切替」とあるが、
要件定義・API仕様にURLroutingの詳細仕様（各ビューのURL形式など）が無い。
**判断**：Phase 1では `apps/web/src/App.tsx` の `useState<ViewSelection>` でビュー切り替えのみ実装し、
URL（`history`/`react-router` 等）とは連動させていない。そのため現状はブラウザの戻る/進む・リンク共有で
特定のリスト/タスクへ直接遷移できない。将来必要になった時点で `react-router-dom` 等の追加を検討する
（現時点で追加すると要件のないルーティング設計を先取りすることになるため見送った）。
