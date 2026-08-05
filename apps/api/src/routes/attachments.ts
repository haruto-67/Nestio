import { Hono } from 'hono';
import { sha256Schema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { detectImageMime } from '../attachments/magic-bytes.js';
import {
  attachmentExists,
  saveAttachmentFile,
  readAttachmentFile,
  computeSha256,
  getUserAttachmentUsageBytes,
  userOwnsAttachment,
} from '../attachments/storage.js';

export const attachmentsRoute = new Hono<{ Variables: AppVariables }>();

attachmentsRoute.use('/attachments/*', requireAuth);

attachmentsRoute.post('/attachments/:sha256', async (c) => {
  const env = c.get('env');
  const db = c.get('db');
  const userId = c.get('userId');
  const logger = c.get('logger');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const sha256Param = c.req.param('sha256');
  if (!sha256Schema.safeParse(sha256Param).success) {
    throw new ApiError('validation_failed', 'sha256の形式が不正です');
  }

  // content-addressedのため既に存在すれば即200（再アップロード不要）
  if (attachmentExists(env.ATTACHMENT_DIR, sha256Param)) {
    return c.body(null, 200);
  }

  const buf = Buffer.from(await c.req.arrayBuffer());

  if (buf.length > env.ATTACHMENT_MAX_BYTES) {
    throw new ApiError('payload_too_large', `ファイルサイズが上限（${env.ATTACHMENT_MAX_BYTES}バイト）を超えています`);
  }

  const usage = getUserAttachmentUsageBytes(db, userId);
  if (usage + buf.length > env.ATTACHMENT_QUOTA_BYTES) {
    throw new ApiError('payload_too_large', 'ユーザーの総容量上限を超えています');
  }

  // クライアント申告のsha256を信用せず再計算する（任意のハッシュ名でのファイル設置を防ぐ）
  const actualSha256 = computeSha256(buf);
  if (actualSha256 !== sha256Param) {
    throw new ApiError('validation_failed', 'SHA-256がURLの値と一致しません');
  }

  // クライアント申告のContent-Typeではなくマジックバイトで実体形式を検証する
  const mime = detectImageMime(buf);
  if (!mime) {
    throw new ApiError('validation_failed', '画像形式として認識できませんでした');
  }

  saveAttachmentFile(env.ATTACHMENT_DIR, sha256Param, buf, env.ATTACHMENT_ENCRYPTION_KEY || undefined);
  logger.info({ sha256: sha256Param, bytes: buf.length, mime }, 'attachment_uploaded');

  return c.body(null, 201);
});

attachmentsRoute.get('/attachments/:sha256', (c) => {
  const env = c.get('env');
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const sha256Param = c.req.param('sha256');
  if (!sha256Schema.safeParse(sha256Param).success) {
    throw new ApiError('validation_failed', 'sha256の形式が不正です');
  }

  // 他人の添付をURL推測で見られないよう、そのユーザーが参照レコードを持っているか確認する
  if (!userOwnsAttachment(db, userId, sha256Param)) {
    throw new ApiError('not_found', '添付ファイルが見つかりません');
  }
  if (!attachmentExists(env.ATTACHMENT_DIR, sha256Param)) {
    throw new ApiError('not_found', '添付ファイルが見つかりません');
  }

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Disposition', 'inline');

  // リバースプロキシがCaddy（X-Accel-Redirectのようなnginx専用の委譲機構を持たない）のため、
  // 環境を問わずアプリから直接返す。添付サイズはATTACHMENT_MAX_BYTES（既定10MB）で
  // 上限があるため、同期的な読み込みでも実用上問題にならない。
  const data = readAttachmentFile(env.ATTACHMENT_DIR, sha256Param, env.ATTACHMENT_ENCRYPTION_KEY || undefined);
  return c.body(Uint8Array.from(data));
});
