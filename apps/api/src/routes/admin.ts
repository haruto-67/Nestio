import { Hono } from 'hono';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import {
  listAccessRequests,
  findAccessRequestById,
  decideAccessRequest,
  type AccessRequestStatus,
} from '../auth/access-requests.js';
import { findOrCreateUser } from '../auth/users.js';

export const adminRoute = new Hono<{ Variables: AppVariables }>();

adminRoute.use('/admin/*', requireAuth, requireAdmin);

function parseStatusFilter(raw: string | undefined): AccessRequestStatus | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'pending' || raw === 'approved' || raw === 'rejected') return raw;
  throw new ApiError('validation_failed', 'statusはpending/approved/rejectedのいずれかです');
}

adminRoute.get('/admin/access-requests', (c) => {
  const db = c.get('db');
  const status = parseStatusFilter(c.req.query('status'));
  return c.json(listAccessRequests(db, status));
});

adminRoute.post('/admin/access-requests/:id/approve', (c) => {
  const db = c.get('db');
  const logger = c.get('logger');
  const id = c.req.param('id');

  const req = findAccessRequestById(db, id);
  if (!req) throw new ApiError('not_found', '申請が見つかりません');
  if (req.status !== 'pending') throw new ApiError('conflict', 'すでに処理済みの申請です');

  const decided = decideAccessRequest(db, id, 'approved');
  if (!decided) throw new ApiError('conflict', 'すでに処理済みの申請です');

  // 次回ログイン時を待たず、承認した時点で本登録しておく
  const user = findOrCreateUser(db, {
    sub: decided.google_sub,
    email: decided.email,
    email_verified: true,
    name: decided.display_name,
    picture: decided.avatar_url ?? undefined,
  });
  logger.info({ access_request_id: id, user_id: user.id }, 'access_request_approved');

  return c.json({ user_id: user.id });
});

adminRoute.post('/admin/access-requests/:id/reject', (c) => {
  const db = c.get('db');
  const logger = c.get('logger');
  const id = c.req.param('id');

  const req = findAccessRequestById(db, id);
  if (!req) throw new ApiError('not_found', '申請が見つかりません');
  if (req.status !== 'pending') throw new ApiError('conflict', 'すでに処理済みの申請です');

  const decided = decideAccessRequest(db, id, 'rejected');
  if (!decided) throw new ApiError('conflict', 'すでに処理済みの申請です');

  logger.info({ access_request_id: id }, 'access_request_rejected');
  return c.body(null, 204);
});
