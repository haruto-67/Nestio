# 手動作業リスト（Claude Code に任せられない部分）

外部サービスの登録、鍵の生成、実機確認はここに集約する。
Phase 6 でこの内容を実際の値を埋めた `docs/使い方.md` に仕上げる。

---

## A. Phase 1 の前にやること

### A-1. Google OAuth クライアントの登録

1. Google Cloud Console でプロジェクトを作成
2. 「APIとサービス」→「OAuth 同意画面」
   - User Type：**外部**
   - スコープは `openid` / `email` / `profile` のみ
   - **テストユーザーに自分の Google アカウントを追加する**
     - これをやらないと「未検証のアプリ」警告で先に進めない
     - 自分しか使わないなら公開申請は不要（テストユーザーのままでよい）
3. 「認証情報」→「OAuth クライアント ID」→ ウェブアプリケーション
4. 承認済みリダイレクト URI に両方を登録：
   - `http://localhost:3000/api/v1/auth/google/callback`（開発用）
   - `https://nestio.niwatorimc.com/api/v1/auth/google/callback`（本番）
5. クライアント ID とシークレットを `.env` へ

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=     # 上記の承認済みリダイレクトURIと完全一致させる
SESSION_SECRET=          # openssl rand -base64 32
```

> リダイレクト URI は末尾スラッシュまで完全一致。ここのミスが最頻出。

---

## B. Phase 4 の前にやること

### B-1. VAPID 鍵の生成

```bash
npx web-push generate-vapid-keys
```

```
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:あなたのメールアドレス
```

- 秘密鍵は再発行すると**既存の購読が全て無効になる**。バックアップしておく

### B-2. iPhone / iPad での通知確認

1. Safari で `https://nestio.niwatorimc.com` を開く
2. 共有 →「**ホーム画面に追加**」
   - iOS の Web Push は**ホーム画面に追加した場合のみ動作する**。Safari のタブでは通知が出ない
3. ホーム画面のアイコンから起動
4. アプリ内の「通知を有効にする」ボタンをタップして許諾
   - 許諾ダイアログは**ユーザー操作を起点にしないと出せない**（自動表示は不可）
5. ポモドーロを 1 分で起動し、通知が届くか確認
6. アプリを閉じた状態でも届くか確認

---

## C. Phase 6（デプロイ）でやること

### C-1. DNS

- お名前.com で `nestio.niwatorimc.com` の A レコードを Pi のグローバル IP に向ける
  - 既存の Cloudflare 構成に合わせる場合はそちらで設定
- ルーターのポート開放は既存の 80 / 443 をそのまま使う

### C-2. 証明書

```bash
sudo certbot --nginx -d nestio.niwatorimc.com
```

### C-3. nginx

以下を必ず含める。

```nginx
server {
    server_name nestio.niwatorimc.com;

    # --- TLS 強化（certbot が入れる行に加えて）---
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_stapling on;
    ssl_stapling_verify on;
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE はバッファリングを切らないと差分が届かない
    location /api/v1/sync/stream {
        proxy_pass http://127.0.0.1:3000;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }

    # 添付の実体配信（API が X-Accel-Redirect で指定する）
    location /internal-attachments/ {
        internal;
        alias /var/lib/nestio/attachments/;
    }
}
```

### C-4. Minecraft サーバー側のメモリ調整

Nestio + Docker で 400〜500MB 程度を使う。現状は Java ヒープを 8GB 分コミットしているため、先に空きを作る。

- Lobby の `-Xmx` を 6G → 5G に下げる
- 変更後に Glances で `free -h` とスワップ使用量を確認

### C-5. バックアップ cron

```bash
# 毎日 4:00
0 4 * * * sqlite3 /var/lib/nestio/nestio.db ".backup /tmp/nestio-backup.db" \
  && rclone copy /tmp/nestio-backup.db dropbox:backup/nestio/ \
  && rm /tmp/nestio-backup.db
```

- **DB 本体を rclone マウント上に置かないこと**（ロックが壊れて破損する）
- 添付ディレクトリも週次で rclone sync する

### C-6. ufw の確認

Docker は iptables を直接書き換えるため ufw を貫通する。

```bash
sudo ss -tlnp | grep 3000     # 127.0.0.1:3000 になっているか
curl http://<PiのグローバルIP>:3000   # 外部から到達できないことを確認
```

到達できてしまう場合、compose のポート指定が `3000:3000` になっている。

---

## D. Phase 5（連携）でやること

### D-1. Claude Code の実行環境

- Pi の Claude Code に**専用の低権限ユーザー**を用意する
- 作業ディレクトリを固定し、それ以外に書き込めないようにする
- `--allowedTools` で使用可能ツールを絞る
- `HATCH_SCRIPTS` に実行を許可するスクリプトのキーとパスを登録

```
CLAUDE_BIN=/usr/local/bin/claude
CLAUDE_WORKDIR=/var/lib/nestio/hatch
CLAUDE_TIMEOUT_SEC=120
HATCH_SCRIPTS=mc_backup:/opt/scripts/mc-backup.sh,rcon:/opt/scripts/rcon.sh
DISCORD_WEBHOOKS=default:https://discord.com/api/webhooks/...
```

### D-2. カレンダー購読

1. アプリでフィードを作成し URL をコピー
2. Google カレンダー：他のカレンダー → URL で追加
   - **反映は数時間〜1 日かかる**。即時同期はされない（Google 側の仕様）
3. iPhone：設定 → カレンダー → アカウント → 追加 → その他 → 照会するカレンダーを追加
   - こちらは更新間隔を指定できる

### D-3. MCP 接続

1. Claude 側にリモート MCP サーバーとして URL を登録
   - URL：`https://nestio.niwatorimc.com/api/v1/mcp`（`mcpRoute` は `/api/v1` 配下にマウントされている。
     `/mcp` 単体だとSPAの `index.html` にフォールバックしてしまうので注意）
2. 接続時に Nestio の認可画面が開くので、ログインして許可する（OAuth）
   - 固定トークンの貼り付けではなく、この認可フローで接続する
   - 既存の `niwatorimc.com/mcp`（Discord）で OAuth Client が必要だったのと同じ理由

---

## E. 環境変数まとめ

```
# 認証
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
SESSION_SECRET=
APP_ORIGIN=https://nestio.niwatorimc.com

# 通知
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=

# ストレージ
DB_PATH=/var/lib/nestio/nestio.db
ATTACHMENT_DIR=/var/lib/nestio/attachments
ATTACHMENT_MAX_BYTES=10485760
ATTACHMENT_QUOTA_BYTES=2147483648

# Hatch
CLAUDE_BIN=
CLAUDE_WORKDIR=
CLAUDE_TIMEOUT_SEC=120
HATCH_SCRIPTS=
DISCORD_WEBHOOKS=

# 保持期間
TOMBSTONE_RETENTION_DAYS=30

# ログ
LOG_LEVEL=info
LOG_DIR=/var/lib/nestio/logs
LOG_RETENTION_DAYS=14

# レート制限（1 分あたりのリクエスト数）
RATE_LIMIT_SYNC=120
RATE_LIMIT_AUTH=20
RATE_LIMIT_MCP=60
RATE_LIMIT_ATTACHMENT=60
RATE_LIMIT_CLIENT_LOGS=30
```

---

## F. ログの見方（トラブル時）

構造化 JSON なので `jq` で整形して読む。

```bash
# 直近のエラーだけ見る
tail -n 200 /var/lib/nestio/logs/nestio-$(date +%F).log | jq 'select(.level=="error")'

# 特定リクエストの一連の処理を追う
grep '<request_id>' /var/lib/nestio/logs/*.log | jq .

# Hatch（claude -p）の失敗を追う
tail -f /var/lib/nestio/logs/*.log | jq 'select(.scope=="hatch")'
```

- アプリ内の簡易ログビューアでも直近のエラーを時系列で確認できる
- 端末側で同期がおかしいときは、アプリの設定画面から「ログを送信」を押すと端末ログがサーバーに集まる

---

## G. アイコンの書き出し（Canva）

確定アイコンの編集用：`https://www.canva.com/d/3-dI-GIjYx1e-ML`

PWA 用に以下を書き出して `apps/web/public/icons/` に配置する。

| ファイル | サイズ | 用途 |
|---|---|---|
| `icon-192.png` | 192×192 | manifest（通常） |
| `icon-512.png` | 512×512 | manifest（通常・スプラッシュ） |
| `icon-192-maskable.png` | 192×192 | manifest（マスカブル。周囲に余白を持たせる） |
| `icon-512-maskable.png` | 512×512 | 同上 |
| `apple-touch-icon.png` | 180×180 | iOS ホーム画面 |
| `favicon.ico` | 32×32 | ブラウザタブ |

- **マスカブル版は要素を中央 80% に収める**（OS が角丸や円形に切り抜くため、端が欠ける）
- Canva からは PNG で書き出し、`manifest.webmanifest` の `icons` に `purpose: "any"` と `purpose: "maskable"` を分けて登録する
