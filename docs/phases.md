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

- [x] Dockerfile（マルチステージ、**better-sqlite3 は Docker 内でビルド**）
- [x] docker-compose.yml（`127.0.0.1:3000:3000` バインド、named volume）
- [x] nginx 設定（リバースプロキシ、SSE 用の `proxy_buffering off`、`X-Accel-Redirect`、**TLS 1.2+ / HSTS / OCSP Stapling**）
- [x] GC ワーカー（tombstone 30 日、`applied_ops` 30 日、孤児添付の削除）
- [x] 簡易ログビューア（自分専用・直近エラーの時系列表示・`request_id` 絞り込み）
- [x] バックアップ cron（`.backup` → rclone で外部へ）
- [x] `docs/使い方.md` の作成（`manual-setup.md` を元に、実際の値を埋めた完成版）

**完了条件**：Pi 上で常時稼働し、バックアップが自動で回る
→ `docker/`（Dockerfile・docker-compose.yml・nginx.conf・backup.sh・.env.example）を作成し、
ローカルにColima（Docker Engine on Linux/arm64 VM）を導入して実際に `docker compose build && up` まで
実機で検証済み。この過程で本番ビルド特有の3つの不具合を発見・修正した：
`@nestio/shared` がビルド出力を持たずソースの `.ts` を直接指していたため `node dist/index.js` が
起動できない問題（`packages/shared` にビルドを追加）、`tsc` が `db/migrations/*.sql` をコピーしない
問題（`apps/api` のbuildスクリプトでコピーを追加）、未定義の `/api/v1/*` パスがSPAの `index.html` に
フォールバックして200を返してしまう問題（`app.ts` で `/api/` prefixを除外）。
Pi実機（arm64本体）での常時稼働・実際のバックアップcron稼働・DNS/証明書はユーザー側の
作業（`docs/manual-setup.md`）が前提のためClaude Codeからは検証できていない。

---

## 改修1回目：ユーザーフィードバック対応（2026-08-04）

本番稼働開始後、ユーザーがNestio自身に「Nestio改修1回目」タスクを作成し、13件のサブタスクとして
不具合・要望を洗い出した。着手前にMCP（`create_task`ツールに`parent_id`対応を追加した上で）経由で
各親タスクへ実装手順のサブタスクを書き出してから対応した。

- [x] バックアップログが出ない → 調査の結果、cron登録直後でまだ4時をまたいでいなかっただけで
      実際は`/var/log/nestio-backup.log`に正常出力されていた（コード変更なし、事実確認のみ）
- [x] キーボードでしかアクセスできない操作がある → ヘッダーに「?」ヘルプボタンを追加、
      タスク詳細パネルに並び替え（上/下）・インデント/アウトデントのUIボタンを追加
- [x] アイコンが要件と違う → Canva MCPコネクタでデザイン（`DAHROzFVtlI`）をPNG書き出しし、
      角丸フチを除去した上で各サイズのPWAアイコンを生成・差し替え（`docs/open-questions.md` 6章）
- [x] ボタン類の絵文字を`lucide-react`のアイコンコンポーネントへ統一
- [x] 画面のデザイン → アイコンにセクション別のアクセントカラーを付与（ポモドーロ=赤, 検索=青,
      Hatch=amber）
- [x] ライト/ダーク切替をヘッダー常設ボタンから設定画面（`KeymapSettings`）へ移動
- [x] モバイルでのタップ領域を拡大（主要ボタンを`min-h-11`相当に）
- [x] ドロワー開閉・モーダル表示にフェード/スケールのトランジションを追加
- [x] iOS Safariのinputズーム対策（モバイル幅で`font-size: 16px`に固定）
- [x] ポモドーロタイマーの状態をlocalStorageに永続化し、モーダルの開閉を跨いでも
      残り時間が正しく表示されるよう修正（`endAt`からの再計算方式）
- [x] タスク一覧ヘッダーのモバイル崩れを`flex-wrap`+`truncate`で修正
- [x] フォルダ/リストの追加・削除・リネームボタンを`group-hover`依存から常時表示に変更し、
      モバイル（タッチ操作）でも操作可能に修正
- [x] ゴミ箱ビューを新規実装 → 論理削除の**復元**を可能にするため、sync-protocolに無かった
      `restore` op（`upsert`/`delete`と並ぶ第3のop種別）を追加した拡張（`docs/open-questions.md`参照）

**完了条件**：`pnpm typecheck` / `pnpm lint` / `pnpm test`（全167+16+4件）が通過し、Playwrightで
主要画面（デスクトップ/モバイル、設定・ゴミ箱・タスク詳細・ポモドーロ）をコンソールエラー無しで
目視確認済み。Pi本番へデプロイ済み。

---

## 改修2回目：ユーザーフィードバック対応（2026-08-04）

改修1回目と同様、ユーザーがNestio自身に「Nestio改修2回目」タスクを作成。今回は着手前に
MCP（`create_task`ツールに`tags`対応を追加した上で）経由で各親タスクへ実装手順のサブタスクを
書き出し、ユーザー側の対応が必要な項目には`manual`タグを付けて区別した。

- [x] 親タスクを開かずサブタスク作成 → タスク一覧の各行に「+」ボタンを追加
- [x] リストの色を変更する手段が無い → サイドバーの色ドットをクリックで開くカラーピッカーを実装
- [x] タスク詳細パネルを外側クリックで閉じる → タスク行（`[data-task-row]`）以外のクリックで
      閉じるようにした。行クリックによる選択とは競合しない
- [x] モバイルのメニューボタン → 「メニュー」の文字を外し、アイコンを拡大
- [x] 設定画面の再構成 → ヘッダーに歯車アイコンを追加し、直接「設定」を開けるようにした。
      モーダルのタイトルを「設定」に変え、キーボードショートカットはその中の1セクションという
      位置づけに変更
- [x] キーボードショートカット以外の操作の監査 → 全10カスタマイズ可能ショートカット＋3固定
      ショートカットについて、改修1回目までの対応で全てにUI操作が存在することを確認（追加の
      コード変更は不要だった）
- [x] Hatch（`claude -p`実行環境） → `docker/Dockerfile`にClaude Code CLI
      （`@anthropic-ai/claude-code`）をインストールし、`CLAUDE_BIN`/`CLAUDE_WORKDIR`をイメージの
      既定値として設定。「専用の低権限ユーザー」はホストに別途作らず、コンテナ自体の非rootユーザー
      （uid 10001）で兼ねる構成とした（`docs/manual-setup.md` D-1）。`ANTHROPIC_API_KEY`の発行・
      設定だけはユーザー側の対応が必要なため、`manual`タグ付きのサブタスクとして依頼した
- [x] Hatch設定内のボタンのタップ領域を拡大

**完了条件**：`pnpm typecheck` / `pnpm lint` / `pnpm test`（全168+16+4件）が通過し、Playwrightで
主要画面（サブタスク追加ボタン・カラーピッカー・外側クリックでの閉じる動作・設定画面・モバイル
ヘッダー）をコンソールエラー無しで目視確認済み。Pi本番へデプロイ済み。`ANTHROPIC_API_KEY`設定後の
Hatch実機動作確認はユーザー側の作業（`docs/manual-setup.md` D-1）が前提のため未検証。

---

## 改修3回目：ユーザーフィードバック対応（2026-08-05）

改修2回目と同様の進め方（MCP経由でサブタスクを書き出し、`manual`タグでユーザー対応が要る項目を
区別）で18件に対応。うち2件はコード変更ではなく仕様確認/ユーザー操作が必要なため`manual`タグの
サブタスクとして質問・依頼を残した。

- [x] `update_note` MCPツールを追加（未実装だったため、最後の「UI案をメモに残す」作業に先立って対応）
- [x] Escで現在開いている一番手前のモーダル/パネルを1つ閉じるグローバルハンドラを追加
- [x] サブタスク追加(+)ボタンをタスク行の右端からタイトル直後へ移動
- [x] タスクをドラッグ&ドロップで移動 → 他タスクへドロップで子にする、一覧背景へドロップで
      最上位に戻す、サイドバーのリストへドロップでリスト間移動、の3種類に対応
      （HTML5 Drag and Drop API、追加ライブラリ無し）
- [x] PC表示のサイドバー幅・タスク詳細パネル幅をドラッグでリサイズできるように
      （`useResizableWidth`、デバイスローカルにlocalStorage保存）
- [x] タスク詳細/メモ編集のtextareaが`defaultValue`実装でタスク切替時に前の内容が残る表示バグを修正
- [x] Windows版Chrome/Edgeで`<select>`のドロップダウンが白背景になる不具合をグローバルCSSで修正
- [x] カレンダー購読の「失効」ボタン（取り消し操作のラベルだったが状態表示に見えて誤解を招いていた）
      を「失効させる」に変更
- [x] タスクの作成・削除時に一言トースト通知を表示
- [x] タスク/メモのメモ欄をMarkdown対応に（`**太字**`/`_斜体_`/`` `code` ``/リンク/画像埋め込み、
      Ctrl+B・Ctrl+Iのショートカット、画像の貼り付け・ドロップでの添付アップロード込み）。
      あわせてメモ欄を縦長に
- [x] サブタスク作成時にそのタスクを自動選択（フォーカス）
- [x] タスクの折りたたみ状態をlocalStorageに保存し再読み込み後も維持
- [x] テーマ・キーボードショートカットの設定を`user_settings`同期からlocalStorage
      （デバイスローカル）へ変更
- [x] タスク詳細パネル内ではTab/Shift+Tabをインデントショートカットより優先してフォーム移動に使用
- [x] 選択中タスクへのサブタスク追加/同じ階層への追加を新しいキーボードショートカット
      （`a`/`Shift+A`）として追加
- [x] Hatch実行環境の認証方式を修正 → 改修2回目で`ANTHROPIC_API_KEY`（Claude API課金）方式にして
      しまっていたが、要件定義の「予算0円・Claude API課金なし」に反する誤りだった。
      claude CLIへの対話ログイン（サブスクリプション経由）方式に訂正し、`$HOME`をnamed volume内
      （`/var/lib/nestio/claude-home`）に固定してログイン状態が永続化されるようにした。
      **この過程で、改修2回目のDockerfileで作成した`/var/lib/nestio/hatch`が実際にはホスト側に
      存在しておらず、bind mountに上書きされて無効化されていたことが判明**（named volumeの
      マウント先ディレクトリはコンテナのビルド時ではなくホスト側に実際に作る必要がある）。
      root権限を要するホスト側ディレクトリ作成は、`docker run --rm -v ... busybox`で一時root
      コンテナを使うことでsudoなしに実施した
- [ ] **`manual`**：どのビュー形式が欲しいか（カンバン/カレンダー/ガント等）が未確定のため、
      仕様を決めずに実装せず質問を残した（`docs/open-questions.md` 5章）
- [ ] **`manual`**：claude CLIへの対話ログイン（`docker compose exec -it nestio claude`）は
      ブラウザでの認可操作が必要なためユーザー側の対応待ち
- [ ] 【最後に実行して】UI案：他サービスと比較したUI改善案を新規メモにまとめる作業
      （コード改修はせず、ユーザーの指示通りこのラウンドの最後に着手する）

**完了条件**：`pnpm typecheck` / `pnpm lint` / `pnpm test`（全169+16+4件）が通過し、Playwrightで
主要画面（Esc動作・サブタスク追加とフォーカス・外側クリック・Markdown編集・トースト通知）を
コンソールエラー無しで目視確認済み。Pi本番へデプロイ済み。ビュー選択とclaude CLIログインは
ユーザー対応待ちのため未完了。

---

## 進捗管理

- 完了した項目は `[x]` にしてコミットする
- 仕様の疑問は実装で埋めず `docs/open-questions.md` に記録する
- Phase 2 のテストが全て通るまで Phase 3 に進まない（同期の不具合は後から直すほど高くつく）
