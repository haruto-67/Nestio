import { Hono } from 'hono';
import { searchQuerySchema, type SearchResponse } from '@nestio/shared';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { searchTasks, searchNotes } from '../search/query.js';

export const searchRoute = new Hono<{ Variables: AppVariables }>();

searchRoute.use('/search', requireAuth);

searchRoute.get('/search', (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const query = searchQuerySchema.parse({ q: c.req.query('q'), limit: c.req.query('limit') });

  const response: SearchResponse = {
    tasks: searchTasks(db, userId, query.q, query.limit),
    notes: searchNotes(db, userId, query.q, query.limit),
  };
  return c.json(response);
});
