# Nestio

タスク管理 PWA。TickTick 代替の個人用アプリ。
本番は Raspberry Pi 5（ARM64 / Ubuntu）上の Docker、`nestio.niwatorimc.com`。

## 必読ドキュメント

作業前に必ず読むこと。

| ファイル | 内容 |
|---|---|
| `docs/requirements.md` | 要件定義。何を作るか |
| `docs/schema.sql` | 確定版 DDL。**勝手に変更しない** |
| `docs/sync-protocol.md` | 同期方式。**この通りに実装する** |
| `docs/api-spec.md` | API 契約 |
| `docs/phases.md` | 実装フェーズと作業単位 |

## 技術スタック（変更禁止）

| レイヤ | 採用 |
|---|---|
| 言語 | TypeScript（`strict: true`） |
| フロント | React 19 + Vite + Tailwind CSS |
| ローカル DB | Dexie（IndexedDB） |
| PWA | vite-plugin-pwa（Workbox） |
| API | Hono + Node.js 22 |
| DB | SQLite（better-sqlite3） |
| バリデーション | Zod（`packages/shared` で共有） |
| 繰り返し | rrule.js |
| 通知 | web-push |
| テスト | Vitest + Playwright |
| ログ | pino（構造化 JSON）+ pino-roll（日次ローテーション） |
| パッケージ管理 | pnpm workspaces |

代替ライブラリを提案しない。ORM は入れない（生 SQL + better-sqlite3 で書く）。

## ディレクトリ構成

```
nestio/
├── apps/
│   ├── web/          # PWA（React）
│   │   ├── src/db/       # Dexie スキーマ・outbox
│   │   ├── src/sync/     # pull / push / SSE
│   │   ├── src/features/ # tasks, notes, search, pomodoro, hatch
│   │   └── src/ui/       # 汎用コンポーネント
│   └── api/          # Hono サーバー
│       ├── src/routes/
│       ├── src/sync/     # 適用ロジック・LWW・検証
│       ├── src/workers/  # push 送信・hatch 実行・GC
│       └── src/db/       # マイグレーション・クエリ
├── packages/shared/  # 型・Zod スキーマ・定数
├── docs/
└── docker/
```

## 絶対に守ること

1. **ID はクライアントが UUIDv7 で採番する。** AUTOINCREMENT を使わない
2. **書き込み経路は `/sync/push` のみ。** リソースごとの POST/PATCH を作らない
3. **時刻は epoch ミリ秒（UTC）で保存し、表示時のみ Asia/Tokyo へ変換。**
   終日タスクの日付だけ `'YYYY-MM-DD'` の TEXT
4. **UI は IndexedDB だけを読む。** コンポーネントから直接 API を叩かない
5. **論理削除のみ。** アプリコードから `DELETE` を発行するのは GC ワーカーだけ
6. **`parent_id` を書き換える時は必ず祖先チェック。** 循環すると再帰クエリが無限ループする
7. **`execFile` を使い `shell: true` は禁止。** ユーザー入力をシェルに渡さない
8. **localStorage / sessionStorage に認証情報を置かない。** セッションは httpOnly / Secure / **SameSite=Strict** Cookie
9. **添付は必ずクライアントで縮小してからアップロード**（長辺 1600px / WebP）。
   サーバーは**マジックバイトで実体形式を検証**し、配信時に `X-Content-Type-Options: nosniff` を付ける
10. **秘密情報をコミットしない。** `.env.example` のみをリポジトリに置く
11. **`/sync/push`・`/auth/*`・`/mcp`・`/attachments/*` にレート制限**を掛ける
12. **MCP 認証は OAuth 2.1（PKCE）。** 固定 Bearer トークンでは Claude が接続できない。
    トークンはハッシュ化保存・有効期限・スコープ（read/write）を持たせる
13. **Google ログインは `email_verified` を検証**してからユーザーを作成 / 参照する
14. **構造化ログ（pino）を全リクエストに `request_id` 付きで出す。** 例外はスタックトレース付き。
    ログにトークン / Cookie を出さない（マスクする）

## 世界観・ネーミング

アプリ名 **Nestio**（nest + io）。巣と卵のモチーフを持つ。

- **機能名は一般名詞のまま**（タスク / リスト / 完了 / 今日 / メモ）。
  ここを独自語に置き換えると初見で操作が推測できなくなる
- 世界観の語は装飾に置く：
  - **Hatch** … トリガー機能の名称（既存の呼び名がない機能なので独自語を当てる）
  - **Egg** … クイック追加のアイコン・空状態のモチーフ（ラベルは「追加」）
  - **Roost** … 「今日」ビューのアイコン・空状態の文言（ラベルは「今日」）
- コード上の識別子は英語。`hatch` はトリガー機能の名前空間として使う

## UI 方針

- TickTick 風の 2 ペイン。左＝フォルダ / リストのツリー、右＝タスク一覧
- iPhone 幅では左をドロワーに格納
- ダーク / ライトの切替のみ。テーマ自作は不要
- 名前順ソートは **`Intl.Collator(undefined, {numeric: true})`** を使う
  （「01.」形式のインデックス運用を想定。単純な文字列比較だと 10 が 2 より前に来る）
- 期限切れタスクは「今日」に**表示上だけ**繰り越す。`due_at` は書き換えない
- キーボードショートカットを標準装備し、キー割り当てはユーザーがカスタマイズ可能にする。
  キーマップは `user_settings.keymap_json` として `/sync` で全デバイスに同期する。
  入力欄フォーカス中は無効化。`?` で一覧表示

## 開発コマンド

```bash
pnpm install
pnpm dev            # web + api を並行起動
pnpm test           # Vitest
pnpm test:e2e       # Playwright
pnpm typecheck
pnpm lint
```

## ビルド上の注意

- **better-sqlite3 はネイティブモジュール。**
  開発機（macOS arm64）でビルドしたバイナリは Pi（linux arm64）で動かない。
  本番イメージは必ず Docker 内でビルドする
- Docker のポート公開は `127.0.0.1:3000:3000` の形にする。
  `-p 3000:3000` と書くと Docker が iptables を直接書き換えて **ufw を貫通する**
- SQLite ファイルと添付ディレクトリは named volume に置く。
  **rclone マウント上には絶対に置かない**（ネットワーク FS はロックが壊れて DB が破損する）

## 作業の進め方

- `docs/phases.md` のチェックリスト単位で進める。**フェーズを飛ばさない**
- 各フェーズ完了時に型チェック・テスト・lint を通してからコミットする
- 仕様に疑問があれば実装で埋めず、`docs/open-questions.md` に追記して先に進む
- 大きなリファクタを提案する前に、現在のフェーズを完了させる
