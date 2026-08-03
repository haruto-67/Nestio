import { Hono } from 'hono';
import type { AppVariables } from '../middleware/request-context.js';

export const healthRoute = new Hono<{ Variables: AppVariables }>().get('/health', (c) => {
  return c.json({ status: 'ok', time: Date.now() });
});
