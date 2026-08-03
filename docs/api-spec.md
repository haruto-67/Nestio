# Nestio API 仕様

- ベース URL：`https://nestio.niwatorimc.com/api/v1`
- 認証：httpOnly / Secure / **SameSite=Strict** の**セッション Cookie**
  - PWA では localStorage にトークンを置かない（XSS で抜かれるため）
  - SameSite=Strict により CSRF（外部サイトからの偽装リクエスト）を防ぐ
- **レート制限**：`/sync/push`・`/auth/*`・`/mcp`・`/attachments/*` にユーザー / IP 単位で適用
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
| GET | `/search?q=&limit=` | タスクとメモを横断検索 |

```jsonc
{
  "tasks": [ { "id": "...", "title": "...", "snippet": "...", "list_id": "..." } ],
  "notes": [ { "id": "...", "title": "...", "snippet": "..." } ]
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

| ツール | 権限 |
|---|---|
| `list_tasks` | read |
| `search_tasks` | read |
| `get_task` | read |
| `list_notes` | read |
| `create_task` | write |
| `update_task` | write |
| `complete_task` | write |
| `create_note` | write |

- 書き込みは内部で `/sync/push` と同じ適用ロジックを通す（seq 採番と検証を共有するため）
