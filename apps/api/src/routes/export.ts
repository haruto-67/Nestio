import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { SYNC_TABLES } from '../sync/tables.js';

export const exportRoute = new Hono<{ Variables: AppVariables }>();

exportRoute.use('/export', requireAuth);

/**
 * 全データのJSONエクスポート（改修5回目・改修4回目のブレインストーム案「データポータビリティ」）。
 * 自己ホストの個人アプリなので母艦（Pi）が壊れた時の可搬バックアップとして、また将来の移行手段として、
 * ユーザー自身がいつでも自分の全データをダウンロードできるようにする。
 * 添付ファイルの実体（画像バイナリ）は含まない（rcloneバックアップが担当領域）。
 */
exportRoute.get('/export', (c) => {
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const db = c.get('db') as Database.Database;
  const tables: Record<string, unknown[]> = {};

  for (const table of Object.keys(SYNC_TABLES)) {
    tables[table] = db
      .prepare(`SELECT * FROM ${table} WHERE user_id = ? AND deleted_at IS NULL`)
      .all(userId);
  }
  const userSettings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);

  const payload = {
    exported_at: Date.now(),
    format_version: 1,
    tables,
    user_settings: userSettings ?? null,
  };

  c.header('Content-Disposition', `attachment; filename="nestio-export-${Date.now()}.json"`);
  return c.json(payload);
});
