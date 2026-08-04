# syntax=docker/dockerfile:1

# better-sqlite3はネイティブモジュールのため、開発機（macOS arm64）でビルドしたバイナリは
# 本番（Pi / linux arm64）で動かない。必ずこのDockerfile内、実行対象と同じアーキテクチャで
# ビルドすること（CLAUDE.md「ビルド上の注意」）。`docker build` はデフォルトでホストと同じ
# アーキテクチャ向けにビルドするため、Pi（arm64）上で `docker compose build` を実行すればよい。

FROM node:22-bookworm-slim AS build

# better-sqlite3はprebuildが無い環境向けにnode-gyp rebuildへフォールバックするため、
# ビルドツール一式を入れておく（prebuild-install || node-gyp rebuild --release）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nestio/shared run build
RUN pnpm --filter @nestio/api run build
RUN pnpm --filter @nestio/web run build

# apps/api本番稼働に必要な分だけを自己完結したディレクトリに書き出す
# （pnpmワークスペースのシンボリックリンクを実ファイルへ解決してくれるため、
# 実行ステージへ node_modules を個別にコピーするより確実）。
RUN pnpm --filter @nestio/api deploy --prod --legacy /app/deploy/api


FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --home-dir /home/nestio --uid 10001 nestio

# Hatch（docs/manual-setup.md D-1）: `claude -p` をコンテナ内から直接execFileで呼び出すため、
# Claude Code CLIをイメージにインストールしておく。コンテナはnestioユーザー（uid 10001、非root）
# としてのみ実行され、CLAUDE_WORKDIR以外への書き込みも許可しない構成にするため、これ自体が
# 「専用の低権限ユーザー」の役割を兼ねる（別途ホストにLinuxユーザーを作る必要はない）。
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY --from=build --chown=nestio:nestio /app/deploy/api ./
COPY --from=build --chown=nestio:nestio /app/apps/web/dist ./web-dist

# DB・添付・ログはdocker-compose側でnamed volumeをマウントする想定のディレクトリ。
# hatchはClaude Codeの作業ディレクトリ（--allowedToolsで許可した範囲以外へ書き込ませないための固定cwd）。
# claude-homeはclaude CLIのログイン認証情報の保存先（$HOMEをここへ向ける。下記参照）。
# 同じnamed volume配下に置くことで、コンテナを再ビルドしてもログイン状態が失われないようにする
RUN mkdir -p /var/lib/nestio/attachments /var/lib/nestio/logs /var/lib/nestio/hatch /var/lib/nestio/claude-home \
    && chown -R nestio:nestio /var/lib/nestio

USER nestio
ENV NODE_ENV=production
ENV PORT=3000
ENV WEB_DIST_DIR=/app/web-dist
ENV DB_PATH=/var/lib/nestio/nestio.db
ENV ATTACHMENT_DIR=/var/lib/nestio/attachments
ENV LOG_DIR=/var/lib/nestio/logs
ENV CLAUDE_BIN=/usr/local/bin/claude
ENV CLAUDE_WORKDIR=/var/lib/nestio/hatch
ENV CLAUDE_TIMEOUT_SEC=120
# 要件定義（budget: Claude API課金なし）の通り、ANTHROPIC_API_KEYは使わずsubscription経由のCLIを
# 叩く。claude CLIはログイン情報を$HOME配下に保存するため、$HOMEをnamed volume内へ向けて
# コンテナ再ビルド後もログイン状態を保持できるようにする。ログイン自体は`docker compose exec -it`
# での対話操作が必要なためユーザー側の一度きりの作業（docs/manual-setup.md D-1）
ENV HOME=/var/lib/nestio/claude-home

EXPOSE 3000

# tiniをPID1にしてSIGTERM/SIGINTをNodeプロセスへ正しく転送する
# （index.tsのgraceful shutdownハンドラがワーカー停止・DB close後に終了するため）
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
