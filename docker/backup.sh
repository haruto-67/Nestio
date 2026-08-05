#!/bin/sh
# 毎日のDBバックアップ（cron から実行する。docs/使い方.md 4章参照）。
# SQLiteのオンラインバックアップ機能（.backup）で安全にコピーしてから、
# 既にrclone mountされているディレクトリへプレーンなファイルコピーで書き出す
# （マウント先はFUSE経由でロック挙動が不安定なため、DB本体もライブの.backup処理も
# マウント上では直接行わず、一度ローカルの/tmpで完成させてからコピーする）。
#
# crontab例（毎日4:00、直近14世代を保持）:
#   0 4 * * * /path/to/docker/backup.sh >> /var/log/nestio-backup.log 2>&1
set -eu

DB_PATH="${NESTIO_DB_PATH:-/var/lib/nestio/nestio.db}"
ATTACHMENT_DIR="${NESTIO_ATTACHMENT_DIR:-/var/lib/nestio/attachments}"
BACKUP_DIR="${NESTIO_BACKUP_DIR:-/home/tori/dropbox/nestio}"
KEEP="${NESTIO_BACKUP_KEEP:-14}"
# docker composeでの通知送信に使う（改修5回目）。空にすると通知をスキップする
COMPOSE_FILE="${NESTIO_COMPOSE_FILE:-$(dirname "$0")/docker-compose.yml}"
TMP_BACKUP="$(mktemp /tmp/nestio-backup-XXXXXX.db)"

cleanup() {
  rm -f "$TMP_BACKUP"
}
trap cleanup EXIT

# バックアップ失敗時、実行中のコンテナ経由でpush通知を送る（ベストエフォート。失敗してもバックアップ自体は
# 既にログに残っているので、通知の送信失敗でスクリプト全体を止めない）
notify_failure() {
  message="$1"
  echo "[$(date -Is)] 失敗: $message" >&2
  if [ -n "$COMPOSE_FILE" ] && [ -f "$COMPOSE_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" exec -T nestio node dist/scripts/notify-all-users.js \
      "Nestioバックアップ失敗" "$message" 2>&1 || echo "[$(date -Is)] 通知の送信にも失敗しました" >&2
  fi
}
trap 'notify_failure "backup.shが異常終了しました（詳細はnestio-backup.logを確認してください）"' ERR

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] DBバックアップを開始: $DB_PATH"
# CLAUDE.md「ビルド上の注意」：DB本体をrcloneマウント上に直接置かない。
# .backupで/tmp（ローカルディスク）へ書き出してから、完成した静的ファイルとしてコピーする。
sqlite3 "$DB_PATH" ".backup '$TMP_BACKUP'"

# バックアップの自動検証（改修5回目）。「cronが動いている」ことと「実際に復元できる」ことは別なので、
# 整合性チェックと最低限のテーブル存在チェックを行い、壊れたバックアップに気づかず溜め続けるのを防ぐ
INTEGRITY="$(sqlite3 "$TMP_BACKUP" "PRAGMA integrity_check;")"
if [ "$INTEGRITY" != "ok" ]; then
  notify_failure "バックアップファイルの整合性チェックに失敗しました: $INTEGRITY"
  exit 1
fi
USER_COUNT="$(sqlite3 "$TMP_BACKUP" "SELECT count(*) FROM users;")"
if [ "$USER_COUNT" -lt 1 ]; then
  notify_failure "バックアップファイルにusersテーブルの行が1件もありません（空のDBを掴んでいる可能性）"
  exit 1
fi

DEST="$BACKUP_DIR/nestio-$(date +%Y%m%d-%H%M%S).db"
cp "$TMP_BACKUP" "$DEST"
echo "[$(date -Is)] バックアップ完了・検証OK（integrity_check: ok, users: ${USER_COUNT}件）: $DEST"

# 直近N世代だけ残して古いものを削除
ls -1t "$BACKUP_DIR"/nestio-*.db 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f

# 添付は容量が大きいため毎日ではなく週次同期を想定（cron側で日次バックアップとは別行にする）
if [ "${NESTIO_SYNC_ATTACHMENTS:-0}" = "1" ]; then
  echo "[$(date -Is)] 添付ディレクトリを同期"
  mkdir -p "$BACKUP_DIR/attachments"
  rsync -a --delete "$ATTACHMENT_DIR/" "$BACKUP_DIR/attachments/"
fi

echo "[$(date -Is)] 完了"
