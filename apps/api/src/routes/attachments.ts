import { Hono, type Context } from 'hono';
import type Database from 'better-sqlite3';
import { uuidv7, sha256Schema } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { getSessionIdFromRequest, findValidSession } from '../auth/session.js';
import { applySyncOps } from '../sync/apply.js';
import { ApiError } from '../errors.js';
import { detectImageMime } from '../attachments/magic-bytes.js';
import { verifyUploadToken, markUploadTokenConsumed } from '../attachments/upload-tokens.js';
import {
  attachmentExists,
  saveAttachmentFile,
  readAttachmentFile,
  computeSha256,
  getUserAttachmentUsageBytes,
  userOwnsAttachment,
} from '../attachments/storage.js';

export const attachmentsRoute = new Hono<{ Variables: AppVariables }>();

interface UploadAuth {
  userId: string;
  /** MCPのcreate_attachment_upload経由の場合のみセットされる。POST成功時にattachmentレコードを
   * 自動作成する（改修17回目：MCPのアクセストークンはAnthropicのインフラで完結しコンテナ内の
   * Claudeには渡らないため、セッションCookie前提のこの口をcurlで直接叩くには、
   * sha256にひも付いた用途限定のワンタイムトークンで代用する必要がある） */
  autoRecord?: { tokenId: string; ownerType: 'task' | 'note'; ownerId: string; filename: string };
}

const UPLOAD_TOKEN_ERROR_MESSAGE: Record<'not_found' | 'expired' | 'used' | 'attempts_exceeded', string> = {
  // トークンの存在有無を推測されにくくするため、そもそも一致しなかった場合だけ曖昧なメッセージにする
  not_found: 'アップロードトークンが無効か期限切れです',
  expired: 'アップロードトークンの有効期限が切れています。create_attachment_uploadを呼び直してください',
  used: 'このアップロードトークンは既に使用されています',
  attempts_exceeded: 'このアップロードトークンは再試行回数の上限に達しました。create_attachment_uploadを呼び直してください',
};

/** Authorization: Bearer <upload_token> ならワンタイムトークンとして、それ以外はセッションCookieとして認証する */
function resolveUploadAuth(c: Context<{ Variables: AppVariables }>, db: Database.Database, sha256Param: string): UploadAuth {
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const result = verifyUploadToken(db, authHeader.slice('Bearer '.length));
    if (!result.ok) throw new ApiError('unauthenticated', UPLOAD_TOKEN_ERROR_MESSAGE[result.reason]);
    if (result.token.sha256 !== sha256Param) {
      throw new ApiError('validation_failed', 'アップロードトークンのsha256とURLのsha256が一致しません');
    }
    return {
      userId: result.token.userId,
      autoRecord: {
        tokenId: result.tokenId,
        ownerType: result.token.ownerType,
        ownerId: result.token.ownerId,
        filename: result.token.filename,
      },
    };
  }

  const sessionId = getSessionIdFromRequest(c);
  const session = sessionId ? findValidSession(db, sessionId) : undefined;
  if (!session) throw new ApiError('unauthenticated', 'セッションが見つかりません');
  return { userId: session.user_id };
}

function createAttachmentRecord(
  db: Database.Database,
  userId: string,
  sha256: string,
  record: { ownerType: 'task' | 'note'; ownerId: string; filename: string; mime: string; bytes: number },
): void {
  const result = applySyncOps(db, userId, [
    {
      op_id: uuidv7(),
      table: 'attachments',
      id: uuidv7(),
      op: 'upsert',
      updated_at: Date.now(),
      fields: {
        owner_type: record.ownerType,
        owner_id: record.ownerId,
        sha256,
        filename: record.filename,
        mime: record.mime,
        bytes: record.bytes,
      },
    },
  ]);
  if (result.rejected.length > 0) {
    throw new ApiError('validation_failed', `添付レコードの作成に失敗しました: ${result.rejected[0]?.reason}`);
  }
}

attachmentsRoute.post('/attachments/:sha256', async (c) => {
  const env = c.get('env');
  const db = c.get('db');
  const logger = c.get('logger');

  const sha256Param = c.req.param('sha256');
  if (!sha256Schema.safeParse(sha256Param).success) {
    throw new ApiError('validation_failed', 'sha256の形式が不正です');
  }

  const auth = resolveUploadAuth(c, db, sha256Param);

  // content-addressedのため既に存在すれば即200（再アップロード不要）。ただしトークン経由の
  // アップロードは、実体は既にあってもattachmentレコードがまだ無い可能性があるため作成する
  if (attachmentExists(env.ATTACHMENT_DIR, sha256Param)) {
    if (auth.autoRecord) {
      const existing = readAttachmentFile(env.ATTACHMENT_DIR, sha256Param, env.ATTACHMENT_ENCRYPTION_KEY || undefined);
      const mime = detectImageMime(existing) ?? 'application/octet-stream';
      createAttachmentRecord(db, auth.userId, sha256Param, { ...auth.autoRecord, mime, bytes: existing.length });
      markUploadTokenConsumed(db, auth.autoRecord.tokenId);
    }
    return c.body(null, 200);
  }

  const buf = Buffer.from(await c.req.arrayBuffer());

  if (buf.length > env.ATTACHMENT_MAX_BYTES) {
    throw new ApiError('payload_too_large', `ファイルサイズが上限（${env.ATTACHMENT_MAX_BYTES}バイト）を超えています`);
  }

  const usage = getUserAttachmentUsageBytes(db, auth.userId);
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
  logger.info(
    { sha256: sha256Param, bytes: buf.length, mime, via: auth.autoRecord ? 'upload_token' : 'session' },
    'attachment_uploaded',
  );

  if (auth.autoRecord) {
    createAttachmentRecord(db, auth.userId, sha256Param, { ...auth.autoRecord, mime, bytes: buf.length });
    markUploadTokenConsumed(db, auth.autoRecord.tokenId);
  }

  return c.body(null, 201);
});

attachmentsRoute.get('/attachments/:sha256', requireAuth, (c) => {
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
