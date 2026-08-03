#!/bin/sh
# 毎日のDBバックアップ（cron から実行する。docs/manual-setup.md C-5参照）。
# SQLiteのオンラインバックアップ機能（.backup）でロック中でも安全にコピーし、rcloneで外部へ送る。
#
# crontab例（毎日4:00）:
#   0 4 * * * /path/to/docker/backup.sh >> /var/log/nestio-backup.log 2>&1
set -eu

DB_PATH="${NESTIO_DB_PATH:-/var/lib/nestio/nestio.db}"
ATTACHMENT_DIR="${NESTIO_ATTACHMENT_DIR:-/var/lib/nestio/attachments}"
RCLONE_REMOTE="${NESTIO_RCLONE_REMOTE:-dropbox:backup/nestio}"
TMP_BACKUP="$(mktemp /tmp/nestio-backup-XXXXXX.db)"

cleanup() {
  rm -f "$TMP_BACKUP"
}
trap cleanup EXIT

echo "[$(date -Is)] DBバックアップを開始: $DB_PATH"
# DB本体をrcloneマウント上に直接置いていないため、.backupで一時ファイルへ書き出してから転送する
# （CLAUDE.md「ビルド上の注意」：ネットワークFS上に直接置くとロックが壊れてDBが破損する）。
sqlite3 "$DB_PATH" ".backup '$TMP_BACKUP'"

echo "[$(date -Is)] rcloneへ転送: $RCLONE_REMOTE"
rclone copy "$TMP_BACKUP" "$RCLONE_REMOTE/" --config /root/.config/rclone/rclone.conf

# 添付は容量が大きいため毎日ではなく週次同期を想定（cron側で日次バックアップとは別行にする）
if [ "${NESTIO_SYNC_ATTACHMENTS:-0}" = "1" ]; then
  echo "[$(date -Is)] 添付ディレクトリをrclone syncで同期"
  rclone sync "$ATTACHMENT_DIR" "$RCLONE_REMOTE/attachments" --config /root/.config/rclone/rclone.conf
fi

echo "[$(date -Is)] バックアップ完了"
