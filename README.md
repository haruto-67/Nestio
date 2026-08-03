# Nestio

タスク管理 PWA（TickTick 代替の個人用アプリ）。オフライン対応、繰り返しタスク、メモ、
添付、ポモドーロ、ICS カレンダー連携、MCP 経由での Claude 連携、そして **Hatch**
（イベント駆動でタスク操作や Claude 実行を自動化するトリガー機能）を備える。

本番は Raspberry Pi 5（ARM64 / Ubuntu）上の Docker で稼働し、`nestio.niwatorimc.com` で公開する。

## 技術スタック

| レイヤ | 採用 |
|---|---|
| 言語 | TypeScript（`strict: true`） |
| フロント | React 19 + Vite + Tailwind CSS + Dexie（IndexedDB） |
| PWA | vite-plugin-pwa（Workbox） |
| API | Hono + Node.js 22 |
| DB | SQLite（better-sqlite3、生 SQL） |
| バリデーション | Zod（`packages/shared` でフロント/バック共有） |
| 繰り返し | rrule.js |
| 通知 | web-push |
| テスト | Vitest + Playwright |
| ログ | pino（構造化 JSON）+ pino-roll |
| パッケージ管理 | pnpm workspaces |

## ディレクトリ構成

```
nestio/
├── apps/
│   ├── web/          # PWA（React）
│   │   ├── src/db/       # Dexieスキーマ・outbox
│   │   ├── src/sync/     # pull / push / SSE
│   │   ├── src/features/ # tasks, notes, search, pomodoro, hatch, logs...
│   │   └── src/api/      # 非同期リソース（calendar/hatch/logs等）への直接fetch
│   └── api/          # Honoサーバー
│       ├── src/routes/
│       ├── src/sync/     # 適用ロジック・LWW・検証
│       ├── src/hatch/    # トリガーのイベント検知・キュー・ワーカー・アクション
│       ├── src/gc/       # tombstone/applied_ops/添付のGCワーカー
│       └── src/db/       # マイグレーション・クエリ
├── packages/shared/  # 型・Zodスキーマ・定数（フロント/バック共有）
├── docker/           # Dockerfile・docker-compose.yml・nginx設定・バックアップスクリプト
└── docs/             # 要件・スキーマ・同期プロトコル・API契約・運用手順
```

## 開発

```bash
pnpm install
pnpm dev            # web (http://localhost:5173) + api (http://localhost:3000) を並行起動
pnpm test           # Vitest（全ワークスペース）
pnpm test:e2e       # Playwright
pnpm typecheck
pnpm lint
```

初回は `.env`（`apps/api` 用）を用意する。開発時に最低限必要なのは以下（他はデフォルト値で動く）。
本番用の値は `docker/.env.example` と `docs/manual-setup.md` を参照。

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SESSION_SECRET=
```

## ドキュメント

作業前に必ず読むこと。仕様の根拠はすべてここにある。

| ファイル | 内容 |
|---|---|
| `docs/requirements.md` | 要件定義 |
| `docs/schema.sql` | 確定版 DDL |
| `docs/sync-protocol.md` | オフライン同期方式（LWW・outbox・SSE・GC） |
| `docs/api-spec.md` | API 契約（Hatch アクション一覧含む） |
| `docs/phases.md` | 実装フェーズと進捗チェックリスト |
| `docs/manual-setup.md` | 外部サービス登録・鍵生成など人手が必要な作業 |
| `docs/使い方.md` | Pi 上での実際のデプロイ・運用手順 |
| `docs/open-questions.md` | 仕様の曖昧さに対する判断ログ |

## 本番デプロイ

```bash
cd docker
cp .env.example .env   # 値を埋める（docs/manual-setup.md参照）
docker compose build   # 必ずPi上（arm64）でビルドする
docker compose up -d
```

詳細は `docs/使い方.md` を参照。

## 絶対に守ること（抜粋）

- ID はクライアントが UUIDv7 で採番する（AUTOINCREMENT は使わない）
- 書き込み経路は `/sync/push` のみ（リソースごとの POST/PATCH は作らない）
- 時刻は epoch ミリ秒（UTC）で保存し、表示時のみ Asia/Tokyo へ変換
- UI は IndexedDB だけを読む（コンポーネントから直接 API を叩かない）
- 論理削除のみ（物理削除は GC ワーカーのみが行う）

全文は `CLAUDE.md` を参照。
