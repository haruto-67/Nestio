import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../middleware/request-context.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../errors.js';
import { listTriggerRuns } from '../hatch/queue.js';
import { runHatchAction } from '../hatch/action-runner.js';

export const hatchRoute = new Hono<{ Variables: AppVariables }>();

hatchRoute.use('/hatch/*', requireAuth);

/** api-spec.md 7章のアクション一覧（実装対象） */
const ACTION_METADATA = [
  { key: 'claude_prompt', params: ['template', 'output'] },
  { key: 'claude_subtasks', params: ['max_count'] },
  { key: 'create_task', params: ['list_id', 'title_template', 'due_offset_days'] },
  { key: 'create_note', params: ['title_template', 'body_template'] },
  { key: 'add_tag', params: ['tag_id'] },
  { key: 'set_priority', params: ['priority'] },
  { key: 'move_to_list', params: ['list_id'] },
  { key: 'push_notify', params: ['title', 'body'] },
  { key: 'discord_notify', params: ['webhook_key', 'message_template'] },
  { key: 'run_registered_script', params: ['script_key'] },
] as const;

hatchRoute.get('/hatch/actions', (c) => c.json(ACTION_METADATA));

hatchRoute.get('/hatch/runs', (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const triggerId = c.req.query('trigger_id') ?? null;
  const limit = Math.min(Number(c.req.query('limit') ?? '50') || 50, 200);
  return c.json(listTriggerRuns(db, userId, triggerId, limit));
});

const testBodySchema = z.object({ subject_id: z.string().uuid().optional() });

interface TriggerRow {
  id: string;
  action_key: string;
  params_json: string;
}

hatchRoute.post('/hatch/:triggerId/test', async (c) => {
  const db = c.get('db');
  const env = c.get('env');
  const logger = c.get('logger');
  const userId = c.get('userId');
  if (!userId) throw new ApiError('unauthenticated', 'セッションが見つかりません');

  const triggerId = c.req.param('triggerId');
  const trigger = db
    .prepare('SELECT id, action_key, params_json FROM triggers WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(triggerId, userId) as TriggerRow | undefined;
  if (!trigger) throw new ApiError('not_found', 'トリガーが見つかりません');

  const raw = await c.req.json().catch(() => ({}));
  const body = testBodySchema.parse(raw);

  try {
    const output = await runHatchAction(db, env, logger, userId, body.subject_id ?? null, trigger);
    return c.json({ output });
  } catch (err) {
    throw new ApiError('internal', err instanceof Error ? err.message : 'action failed');
  }
});
