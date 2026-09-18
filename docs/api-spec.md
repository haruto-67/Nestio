# Nestio API 仕様

- ベース URL：`https://nestio.niwatorimc.com/api/v1`
- 認証：httpOnly / Secure / **SameSite=Strict** の**セッション Cookie**
  - PWA では localStorage にトークンを置かない（XSS で抜かれるため）
  - SameSite=Strict により CSRF（外部サイトからの偽装リクエスト）を防ぐ
- **レート制限**：`/sync/push`・`/auth/*`・`/mcp`・`/attachments/*`・`/public/*` にユーザー / IP 単位で適用
- リクエスト / レスポンスともに JSON（添付アップロードを除く）
- 型定義と Zod スキーマは `packages/shared` に置き、フロントとバックで共有する

## エラー形式

すべてのエラーはこの形で返す。

```jsonc
{ "error": { "code": "forbidden", "message": "..." } }
```

| HTTP | code |
|---|---|
| 400 | `validation_failed` |
| 401 | `unauthenticated` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `conflict`（循環参照、子未完了での親完了 など） |
| 413 | `payload_too_large` |
| 429 | `rate_limited` |
| 500 | `internal` |

## 1. 認証

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/auth/google` | Google 認可画面へリダイレクト（state + PKCE） |
| GET | `/auth/google/callback` | 認可コードを交換し、**`email_verified` を検証**した上でユーザー作成 or 取得。セッション Cookie を発行してアプリへリダイレクト |
| GET | `/auth/me` | 現在のユーザー情報。未認証なら 401 |
| POST | `/auth/logout` | セッション破棄 |
| POST | `/devices` | デバイス登録。`{label}` → `{device_id}`。初回起動時に呼び、以後 IndexedDB に保持 |

## 2. 同期

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/sync/pull?since=&limit=` | 差分取得。詳細は `sync-protocol.md` |
| POST | `/sync/push` | 操作の送信。詳細は `sync-protocol.md` |
| GET | `/sync/stream` | SSE。`bump` イベントのみ |

**CRUD 用の個別エンドポイントは作らない。** 書き込みはすべて `/sync/push` を通す。
2 系統の書き込み経路があると、片方が seq 採番や循環チェックを漏らす。

## 3. 検索

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/search?q=&limit=` | タスク・メモ・ナレッジを横断検索 |

```jsonc
{
  "tasks": [ { "id": "...", "title": "...", "snippet": "...", "list_id": "..." } ],
  "notes": [ { "id": "...", "title": "...", "snippet": "..." } ],
  "knowledge": [ { "id": "...", "title": "...", "snippet": "..." } ]
}
```

- **`q` が 3 文字以上**：FTS5（trigram）を使用
- **`q` が 2 文字以下**：trigram は 3 文字単位のためヒットしない。`LIKE '%q%'` にフォールバックする
- 削除済み（`deleted_at IS NOT NULL`）は除外

## 4. 添付ファイル

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/attachments/{sha256}` | 実体アップロード。body は生バイナリ。既存なら 200 で即返す |
| GET | `/attachments/{sha256}` | 実体取得。セッション検証後 `X-Accel-Redirect` で nginx に委譲 |

- 保存先：`/data/attachments/<sha256の先頭2文字>/<sha256>`
  - 1 ディレクトリにファイルを詰め込みすぎないための 2 階層分割
- **アップロード前にクライアントで長辺 1600px・WebP へ変換**（iOS の HEIC 問題もこれで解消）
- 1 ファイル上限 10MB、ユーザー総容量上限 2GB（`.env` で変更可）
- サーバーは受信データの SHA-256 を再計算し、URL の値と一致しなければ 400
  - これをしないと任意のハッシュ名でファイルを置ける
- **マジックバイトで実体形式を検証**し、画像以外は 400。クライアント申告の Content-Type は信用しない
- 配信時は `X-Content-Type-Options: nosniff` を付け、ブラウザの Content-Sniffing による実行を防ぐ

## 5. カレンダー（ICS）

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/calendar/feeds` | フィード作成。`{list_id?}` → `{token, url}` |
| GET | `/calendar/feeds` | 一覧 |
| DELETE | `/calendar/feeds/{id}` | 失効 |
| GET | `/calendar/{token}.ics` | **認証不要**。トークンで識別。ICS を返す |

- カレンダーアプリは Cookie を送れないため、このエンドポイントのみ Cookie 認証の対象外
- トークンは 32 バイトのランダム値を base64url で
- 終日タスク → `VALUE=DATE`、時刻ありタスク → `DTSTART` に TZID=Asia/Tokyo
- `rrule` はそのまま `RRULE:` 行に出力する（この設計のために RRULE を採用している）
- `Cache-Control: private, max-age=300`

## 6. 通知

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/push/vapid-public-key` | 公開鍵を返す |
| POST | `/push/subscribe` | `{endpoint, keys:{p256dh, auth}}` を登録 |
| DELETE | `/push/subscribe` | 解除 |
| POST | `/pomodoro/schedule` | `{duration_sec, task_id?}` → 終了時刻に push を予約 |
| DELETE | `/pomodoro/schedule/{id}` | 予約取消（タイマー中断時） |

- 期限リマインダーは `scheduled_pushes` にサーバー側で自動投入する
  - タスクの `due_at` / `due_date` 更新時に既存予約をキャンセルし、入れ直す
- 送信ワーカーは 30 秒ごとに `fire_at <= now AND sent_at IS NULL` を拾って送信
- 送信で 404 / 410 が返った購読は削除する（期限切れの購読を貯めない）

## 7. Hatch（トリガー）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/hatch/actions` | 利用可能なアクションキーとパラメータ定義の一覧 |
| GET | `/hatch/runs?trigger_id=&limit=` | 実行ログ |
| POST | `/hatch/{trigger_id}/test` | 手動実行（動作確認用） |

- トリガー定義自体の作成 / 更新 / 削除は `triggers` テーブルとして `/sync/push` 経由で行う
- **`action_key` はサーバー側のホワイトリストに存在するものだけを受け付ける**
- `params_json` は各アクションの Zod スキーマで検証する。検証に通らないものは保存させない

### アクション一覧（実装対象）

| キー | パラメータ | 内容 |
|---|---|---|
| `claude_prompt` | `template`, `output`(`note`/`push`) | 定型プロンプトを `claude -p` で実行 |
| `claude_subtasks` | `max_count` | サブタスク案を生成して子タスクとして追加 |
| `create_task` | `list_id`, `title_template`, `due_offset_days` | テンプレートからタスク生成 |
| `create_note` | `title_template`, `body_template` | メモ生成 |
| `add_tag` | `tag_id` | タグ付与 |
| `set_priority` | `priority` | 優先度変更 |
| `move_to_list` | `list_id` | リスト移動 |
| `push_notify` | `title`, `body` | 自分宛に Web Push |
| `discord_notify` | `webhook_key`, `message_template` | 事前登録した Webhook へ通知 |
| `run_registered_script` | `script_key` | `.env` に登録済みのスクリプトを実行 |

### テンプレート変数

`{{task.title}}` `{{task.note}}` `{{list.name}}` `{{task.due}}` のみ展開する。
**任意の式評価は実装しない。**

### 実行モデル

- `trigger_runs` に `queued` で積み、ワーカーが 1 件ずつ処理する（**同時実行数 1**）
- `claude -p` のタイムアウトは 120 秒、リトライは最大 2 回
- 実行は専用の低権限ユーザー、作業ディレクトリ固定、`--allowedTools` で使用ツールを限定
- ユーザー入力を直接シェルに渡さない。引数配列で `execFile` を使い、`shell: true` は禁止
- **ループ防止**：トリガー起因の書き込みには内部フラグを立て、そこから再発火させない

## 9. クライアントログ

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/client-logs` | 端末のリングバッファログを受信し、サーバーのログファイルへ追記 |

- 端末側の同期障害（outbox 失敗・resync・衝突・SSE 切断）を吸い上げる用途
- `request_id` 相当として `device_id` とクライアント発番の `session_trace_id` を含める
- レート制限の対象に含める（誤送信でログが溢れないように）

## 10. MCP

- エンドポイント：`https://nestio.niwatorimc.com/mcp`
- **認証：OAuth 2.1（Authorization Code + PKCE）。** Nestio 自身が認可サーバーになる
  - Claude のリモート MCP コネクタは固定 Bearer トークンでは接続できないため
  - トークンはハッシュ化して `oauth_tokens` に保存し、有効期限とスコープ（read/write）を持たせる

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/mcp/.well-known/oauth-authorization-server` | 認可サーバーメタデータ |
| POST | `/mcp/oauth/register` | 動的クライアント登録（`oauth_clients`） |
| GET | `/mcp/oauth/authorize` | 認可画面。ログイン済みユーザーが許可すると認可コードを発行 |
| POST | `/mcp/oauth/token` | 認可コード / PKCE 検証子を検証しアクセストークンを発行 |

| ツール | 権限 | 内容 |
|---|---|---|
| `list_tasks` | read | タスク一覧（既定は未完了のみ。`list_id`/`parent_id`/`include_completed`で絞り込み可） |
| `search_tasks` | read | タスクをタイトル・本文で全文検索 |
| `get_task` | read | タスクIDを指定して詳細取得 |
| `list_notes` | read | メモ一覧 |
| `create_task` | write | タスク新規作成（`parent_id`でサブタスク化、`tags`でタグ付与） |
| `update_task` | write | タスク更新（タイトル/本文/優先度/期限/リスト移動/親付け替え/タグ追加削除） |
| `complete_task` | write | タスクを完了にする（繰り返しの次occurrence計算はしない） |
| `delete_task` | write | タスクを論理削除（ゴミ箱） |
| `restore_task` | write | 論理削除したタスクを復元 |
| `create_note` | write | メモ新規作成 |
| `update_note` | write | メモ更新（タイトル/本文/ピン留め） |
| `delete_note` | write | メモを論理削除（ゴミ箱） |
| `restore_note` | write | 論理削除したメモを復元 |
| `list_lists` | read | リスト一覧（id/name/folder_id/color/sort_mode） |
| `create_list` | write | リスト新規作成 |
| `update_list` | write | リストの名前/所属フォルダ/色を変更 |
| `delete_list` | write | リストを論理削除（配下タスクはそのまま） |
| `list_folders` | read | フォルダ一覧 |
| `create_folder` | write | フォルダ新規作成 |
| `update_folder` | write | フォルダ名を変更 |
| `delete_folder` | write | フォルダを論理削除 |
| `list_tags` | read | タグ一覧 |
| `create_tag` | write | タグ新規作成 |
| `update_tag` | write | タグの名前/色を変更 |
| `delete_tag` | write | タグを論理削除 |
| `list_triggers` | read | Hatchトリガー一覧 |
| `create_trigger` | write | Hatchトリガー新規作成 |
| `update_trigger` | write | Hatchトリガー更新（有効/無効の切り替えを含む） |
| `delete_trigger` | write | Hatchトリガーを論理削除 |
| `get_knowledge_index` | read | 全ナレッジの索引（`title`/`description`/`category`/`tags`/`updated_at`）を1リクエストで返す。`body`は含まない（改修24回目） |
| `get_knowledge` | read | ナレッジの本文を取得（`titles`/`ids`どちらも配列で複数指定可） |
| `upsert_knowledge` | write | `title`をキーに作成/更新。新規作成時は`description`必須。`append: true`で本文末尾に追記 |
| `search_knowledge` | read | ナレッジをタイトル・説明・本文で全文検索（スニペット付き） |
| `get_backlinks` | read | 指定ナレッジ（`id`または`title`）への`[[リンク]]`元一覧を返す |

- 書き込みは内部で `/sync/push` と同じ適用ロジックを通す（seq 採番と検証を共有するため）。
  `update_task` の `parent_id` 付け替えも同じ循環参照チェック（`wouldCreateCycle`）を通る
- 一覧・並び替え・表示モードなど表示系の設定（`sort_order` の直接操作、ビュー選択等）はMCPには意図的に公開していない。
  新規作成時の並び順は既存の最後尾に自動で追加される
- `create_task`/`update_task` の `note`、`create_note`/`update_note` の `body` は簡易Markdown記法
  （`**太字**`・`*斜体*`・`` `コード` ``・箇条書き・番号付きリスト・`[text](url)`リンク・空行区切りの段落）を
  受け付け、サーバー側（`@nestio/shared`の`markdownToSafeHtml`）でUIが許可するHTMLタグへ変換してから保存する
  （改修8回目）。人間がUIで直接編集する場合はWYSIWYGのリッチテキスト編集のままで、Markdown記法のパースは
  行わない。この変換はMCP・11章の公開APIの書き込み経路にのみ適用される
- `upsert_knowledge` の `body` 中の `[[タイトル]]`（`[[タイトル|表示名]]` の表示名部分は無視）は
  保存のたびにパースされ、`knowledge_links` に反映される（改修24回目フォローアップ）。
  Obsidianと同じくパスではなくタイトル完全一致で解決し、リンク先がまだ無ければ `to_title` だけの
  未解決リンクとして保持する。リンク先のノートが後から作られると、その時点で未解決リンクを解決する。
  タイトル変更（リネーム）時の参照元一括置換は未対応（`docs/phases.md` 参照）

## 11. 公開API（外部連携用・個人用APIキー認証）

外部スクリプトやZapier等のサービス連携から、MCPのOAuth 2.1（PKCE）フローを踏まずに手軽に
叩けるようにするためのREST API（改修22回目）。

**2章の「CRUD用の個別エンドポイントは作らない」との関係**：あの原則が禁じているのは
"独自の適用ロジックを持つ二重実装"（seq採番や循環チェックを漏らしうるため）であって、
このAPIは新しいロジックを一切持たず、MCPツール（`apps/api/src/mcp/tools.ts`の`callTool`。
内部で`/sync/push`と同じ`applySyncOps`を通す）をそのまま呼ぶ薄いアダプタに徹している。
MCP自身も同じやり方でこの原則の対象外になっている。

### 認証

- ベースパス：`/api/v1/public/*`
- ヘッダー：`Authorization: Bearer <個人用APIキー>`（`nestio_sk_`で始まる）
- キーは平文を保存せずSHA-256ハッシュのみ`api_keys`に保存する（`oauth_tokens`と同じ方針）
- スコープは`read` / `read write`の2値（設定画面では「読み取りのみ」「読み書き」として選択）

### APIキーの発行・管理（セッションCookie認証。設定画面から使う）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api-keys` | 自分のAPIキー一覧（失効済みは含まない。`key`本体は返らない） |
| POST | `/api-keys` | `{name, scope}` → `{id, key, name, scope}`。**`key`はこのレスポンスのみで取得可能** |
| DELETE | `/api-keys/{id}` | 失効させる（`revoked_at`を立てる。物理削除しない） |

### リソースエンドポイント（APIキー認証。MCPツールと1:1対応）

| メソッド | パス | 対応するMCPツール |
|---|---|---|
| GET | `/public/tasks` | `list_tasks`（`list_id`/`parent_id`/`include_completed`/`limit`をクエリで指定） |
| GET | `/public/tasks/search?q=` | `search_tasks` |
| GET | `/public/tasks/{id}` | `get_task` |
| POST | `/public/tasks` | `create_task`（bodyはJSON、MCPツールの引数と同じ形） |
| PATCH | `/public/tasks/{id}` | `update_task` |
| POST | `/public/tasks/{id}/complete` | `complete_task` |
| DELETE | `/public/tasks/{id}` | `delete_task` |
| POST | `/public/tasks/{id}/restore` | `restore_task` |
| GET | `/public/notes` | `list_notes` |
| POST | `/public/notes` | `create_note` |
| PATCH | `/public/notes/{id}` | `update_note` |
| DELETE | `/public/notes/{id}` | `delete_note` |
| POST | `/public/notes/{id}/restore` | `restore_note` |
| GET | `/public/lists` | `list_lists` |
| POST | `/public/lists` | `create_list` |
| PATCH | `/public/lists/{id}` | `update_list` |
| DELETE | `/public/lists/{id}` | `delete_list` |
| GET | `/public/folders` | `list_folders` |
| POST | `/public/folders` | `create_folder` |
| PATCH | `/public/folders/{id}` | `update_folder` |
| DELETE | `/public/folders/{id}` | `delete_folder` |
| GET | `/public/tags` | `list_tags` |
| POST | `/public/tags` | `create_tag` |
| PATCH | `/public/tags/{id}` | `update_tag` |
| DELETE | `/public/tags/{id}` | `delete_tag` |
| GET | `/public/triggers` | `list_triggers` |
| POST | `/public/triggers` | `create_trigger` |
| PATCH | `/public/triggers/{id}` | `update_trigger` |
| DELETE | `/public/triggers/{id}` | `delete_trigger` |

- 各エンドポイントの入力・出力の形は10章のMCPツール一覧と同一（`tools.ts`の`TOOL_DEFS`が単一の情報源）
- `write`スコープが必要な操作を`read`のみのキーで呼ぶと403
- 添付ファイルのアップロード/ダウンロードはMCP専用ツール（`create_attachment_upload`等）のみで、
  このAPIには公開していない（改修22回目時点。必要になったら追加を検討する）

## 12. リスト共有（改修22回目）

リスト単位で既存ユーザーへ編集権限を招待する機能。詳細な同期方式は`sync-protocol.md` 10章を参照。
セッションCookie認証（招待・承諾・解除自体は`/sync/push`を通さない）。

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/list-shares` | `{list_id, invited_email}` → 招待を作成（`invited_email`は既存ユーザーのみ） |
| GET | `/list-shares/outgoing?list_id=` | 自分が送った招待の一覧（`list_id`指定でそのリストのみ） |
| GET | `/list-shares/incoming` | 自分が受け取った招待の一覧（pending/accepted両方） |
| POST | `/list-shares/{id}/accept` | 招待された本人のみ承諾できる。承諾すると既存タスク・リスト自体が複製される |
| DELETE | `/list-shares/{id}` | 共有を解除する。owner（送った側）・招待された側どちらからでも呼べる |

- 権限は「編集権限のみ」（閲覧専用ロールは無い）。承諾した相手はそのリスト内のタスクを
  owner同様に作成・編集・完了・削除できるが、リスト自体の名前/色/削除、フォルダ、
  タグの新規作成、Hatchトリガーはownerのみ
- 新規ユーザーの招待（メール送信によるサインアップ導線）は非対応。招待は
  Nestioに登録済み（`email_verified`済み）のメールアドレスのみ受け付ける

## 13. フォルダ共有（改修22回目フォローアップ）

フォルダ単位で既存ユーザーへ編集権限を招待する機能。API形状・権限モデルは12章のリスト共有と対称。
**リスト共有と異なり動的共有**：以後そのフォルダに追加/移動されたリストも自動的に共有対象になる
（詳細は`sync-protocol.md` 10章「フォルダ共有」を参照）。

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/folder-shares` | `{folder_id, invited_email}` → 招待を作成（`invited_email`は既存ユーザーのみ） |
| GET | `/folder-shares/outgoing?folder_id=` | 自分が送った招待の一覧 |
| GET | `/folder-shares/incoming` | 自分が受け取った招待の一覧（pending/accepted両方） |
| POST | `/folder-shares/{id}/accept` | 招待された本人のみ承諾できる。承諾するとフォルダ自体・配下の全リスト・全タスクが複製される |
| DELETE | `/folder-shares/{id}` | 共有を解除する |
