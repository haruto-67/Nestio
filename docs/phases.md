# Nestio 実装フェーズ

各チェックボックスが 1 セッションで消化できる粒度。上から順に進める。
**フェーズを飛ばさない。** 前のフェーズのテストが通ってから次へ進む。

---

## Phase 0：土台

- [x] pnpm workspaces でモノレポ初期化（`apps/web`, `apps/api`, `packages/shared`）
- [x] TypeScript strict 設定、ESLint、Prettier、Vitest
- [x] `packages/shared` に全テーブルの型と Zod スキーマを定義（`docs/schema.sql` と 1:1）
- [x] UUIDv7 生成ユーティリティ（`packages/shared`）
- [x] `apps/api` に Hono の雛形、ヘルスチェック `/api/v1/health`
- [x] pino による構造化ログ基盤（`request_id` ミドルウェア、例外ハンドラ、秘密情報マスク、日次ローテーション）
- [x] マイグレーション実行器（`docs/schema.sql` を適用し、バージョンを記録）
- [x] `.env.example` を作成

**完了条件**：`pnpm dev` で API が起動し `/health` が 200 を返す

---

## Phase 1：MVP（オンライン前提のタスク管理）

まず**サーバー直結**で動かす。同期層は Phase 2 で挟む。

- [x] Google OAuth（認可コード + PKCE）、セッション Cookie 発行、`/auth/me`
- [x] `/sync/push` の適用ロジック（LWW・seq 採番・冪等性・所有権チェック）
- [x] `/sync/pull`
- [x] 循環参照チェックと親子完了制約のバリデーション
- [x] React 側の骨組み：2 ペインレイアウト、ダーク / ライト切替（URLルーティングは未実装。`docs/open-questions.md` 4章）
- [x] フォルダ / リストのツリー表示と CRUD
- [x] タスク一覧・作成・編集・完了・削除
- [x] 優先度、期限（終日 / 時刻あり）、タグ
- [x] 無制限ネストのサブタスク表示（サーバー側の循環・完了チェックは `WITH RECURSIVE`、フロントのツリー構築はJS実装）
- [x] ソート切替（カスタム / 期限 / 優先度 / 名前）
  - 名前順は `Intl.Collator(numeric: true)`
- [x] スマートリスト（今日 / 明日 / 今週 / 期限なし / 全て / 完了済み）
- [x] 期限切れの「今日」への繰り越し表示（`due_at` は書き換えない）
- [x] キーボードショートカット（既定キーマップ、`?` で一覧、入力欄フォーカス時は無効化）
- [x] キーマップのカスタマイズ UI（`user_settings.keymap_json`、競合警告）
- [x] SameSite=Strict Cookie、`email_verified` 検証、主要エンドポイントのレート制限

**完了条件**：ブラウザから実際にタスク管理として使える

---

## Phase 2：オフライン同期

**ここが最も壊れやすい。`docs/sync-protocol.md` を都度参照すること。**

- [x] Dexie スキーマ定義（サーバーと同じテーブル構成 + `outbox` + `meta`）
- [x] UI の読み取りを全て IndexedDB 経由に切り替え
- [x] outbox 実装（append / FIFO 送信 / マージ / 失敗時の保持）
- [x] pull ループ（`has_more` のページング、初回 `since=0`）
- [x] オンライン復帰時の順序制御（**push → pull**）
- [x] SSE 受信と自動 pull、指数バックオフ再接続、再接続時の pull
- [x] 時計ずれ補正（`clock_skew_ms`）
- [x] `full_resync_required` のハンドリング（クライアント側のみ。サーバー側の判定はPhase 6のGCワーカーと合わせて実装。`docs/open-questions.md` 7章）
- [x] PWA 化（manifest、Service Worker、オフラインシェル。アイコンは仮のSVGプレースホルダ。`docs/open-questions.md` 6章）
- [x] 同期テスト一式（`sync-protocol.md` 第 10 章のうち「31日オフライン→full_resync_required」以外は自動テスト化済み。機内モード実機確認はPlaywrightで実施）
- [x] クライアント側リングバッファログ（同期障害の記録）と `POST /client-logs` への手動送信

**完了条件**：機内モードで編集 → 復帰 → 別デバイスに反映される

---

## Phase 3：繰り返しと検索

- [x] rrule.js 導入。RRULE の生成 UI（毎日 / 毎週 / 毎月 / カスタム）
- [x] 繰り返しタスクの完了処理
  - 元の予定日基準で次の occurrence を算出（`dtstart` をズラさない）
  - 過去分は生成せず、常に直近 1 件のみ表示
- [x] FTS5（trigram）の索引と同期トリガーの動作確認
- [x] `/search` 実装。**3 文字未満は LIKE にフォールバック**
- [x] 検索 UI（タスクとメモを横断）

**完了条件**：「毎週火木」のタスクが 5 日放置しても 1 件だけ出る

---

## Phase 4：メモ・添付・ポモドーロ

- [x] メモ機能（一覧・作成・編集・色・ピン留め）。タスクとは完全に別画面
- [x] 添付：クライアント側の縮小・WebP 変換・SHA-256 計算
- [x] `POST/GET /attachments/{sha256}`、`X-Accel-Redirect` 配信（開発環境はnginxが無いため直接配信にフォールバック）
- [x] オフライン時の Blob 保持と復帰時アップロード（**実体 → メタデータの順**）
- [x] ポモドーロタイマー（おまけ機能。実績記録なし）
- [x] Web Push：VAPID 鍵の読み込み、購読登録、送信ワーカー
- [x] 期限リマインダーの予約と、期限変更時の予約入れ直し
- [x] 404 / 410 が返った購読の自動削除

**完了条件**：iPhone のホーム画面から起動して通知が届く
→ 実装・自動テストは完了。実機での最終確認にはVAPID鍵生成とGoogle OAuth設定（`docs/manual-setup.md` A-1/B-1、ユーザー側の手動作業）が必要で、Claude Codeでは検証できない。

---

## Phase 5：連携（ICS / MCP / Hatch）

- [x] ICS フィード生成（トークン付き URL、`VALUE=DATE` と TZID の出し分け、RRULE 出力）
- [ ] Google カレンダー / Apple カレンダーからの購読確認
- [x] MCP の OAuth 2.1 認可サーバー（`/mcp`、Authorization Code + PKCE、トークンはハッシュ保存）
- [x] MCP サーバー（read/write ツール群、スコープ検証）
- [x] Hatch：トリガー定義の CRUD（`/sync/push` 経由）と設定 UI
- [x] Hatch：ジョブキューとワーカー（**同時実行 1**、タイムアウト 120 秒、リトライ 2 回）
- [x] アクション実装（内部操作系 → 通知系 → `claude_prompt` 系の順）
- [x] **ループ防止フラグ**（トリガー起因の書き込みから再発火させない）
- [ ] `execFile` による実行、専用低権限ユーザー、`--allowedTools` 制限
- [x] 実行ログ画面

**完了条件**：タスク完了で Claude が動き、無限ループしない
→ 実装・自動テストは完了（Hatchのイベント検知・キュー・ワーカー・全10アクション・設定UI・実行ログをカバー）。
未チェックの2項目は環境依存で Claude Code からは検証・実行できない：
「Google/Appleカレンダー購読確認」は実機のカレンダーアプリでの購読確認が必要（`docs/manual-setup.md`）、
「専用低権限ユーザー」はPi上でclaude CLIを実行する専用OSユーザーの用意というデプロイ時の作業（Phase 6のDocker化時に併せて設定）。
`execFile`（`shell: true`不使用）と`--allowedTools`制限自体はコード実装・テスト済み。

---

## Phase 6：運用

- [ ] Dockerfile（マルチステージ、**better-sqlite3 は Docker 内でビルド**）
- [ ] docker-compose.yml（`127.0.0.1:3000:3000` バインド、named volume）
- [ ] nginx 設定（リバースプロキシ、SSE 用の `proxy_buffering off`、`X-Accel-Redirect`、**TLS 1.2+ / HSTS / OCSP Stapling**）
- [x] GC ワーカー（tombstone 30 日、`applied_ops` 30 日、孤児添付の削除）
- [x] 簡易ログビューア（自分専用・直近エラーの時系列表示・`request_id` 絞り込み）
- [ ] バックアップ cron（`.backup` → rclone で外部へ）
- [ ] `docs/使い方.md` の作成（`manual-setup.md` を元に、実際の値を埋めた完成版）

**完了条件**：Pi 上で常時稼働し、バックアップが自動で回る

---

## 進捗管理

- 完了した項目は `[x]` にしてコミットする
- 仕様の疑問は実装で埋めず `docs/open-questions.md` に記録する
- Phase 2 のテストが全て通るまで Phase 3 に進まない（同期の不具合は後から直すほど高くつく）
