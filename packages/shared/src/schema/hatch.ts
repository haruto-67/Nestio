import { z } from 'zod';
import { idSchema, epochMsSchema, seqSchema } from './common.js';

export const triggerEventSchema = z.enum([
  'task_completed',
  'list_all_completed',
  'due_soon',
  'overdue',
  'task_created',
  'recurrence_spawned',
  'schedule',
]);
export type TriggerEvent = z.infer<typeof triggerEventSchema>;

/** ホワイトリスト方式。ここに無いキーは/sync/pushでもワーカーでも拒否する */
export const hatchActionKeySchema = z.enum([
  'claude_prompt',
  'claude_subtasks',
  'claude_summarize',
  'create_task',
  'create_note',
  'add_tag',
  'set_priority',
  'move_to_list',
  'push_notify',
  'discord_notify',
  'run_registered_script',
]);
export type HatchActionKey = z.infer<typeof hatchActionKeySchema>;

const syncable = {
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
  deleted_at: epochMsSchema.nullable(),
  seq: seqSchema,
};

export const triggerRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  name: z.string().min(1),
  event: triggerEventSchema,
  /** list_id / tag_id / priority / offset_minutes / cron などをJSON文字列で保持 */
  condition_json: z.string(),
  action_key: hatchActionKeySchema,
  params_json: z.string(),
  enabled: z.union([z.literal(0), z.literal(1)]),
  ...syncable,
});
export type TriggerRow = z.infer<typeof triggerRowSchema>;

export const triggerWritableFields = triggerRowSchema
  .omit({ id: true, user_id: true, created_at: true, updated_at: true, deleted_at: true, seq: true })
  .partial();
export type TriggerWritableFields = z.infer<typeof triggerWritableFields>;

export const triggerRunStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'timeout']);
export type TriggerRunStatus = z.infer<typeof triggerRunStatusSchema>;

export const triggerRunRowSchema = z.object({
  id: idSchema,
  trigger_id: idSchema,
  user_id: idSchema,
  status: triggerRunStatusSchema,
  subject_id: idSchema.nullable(),
  attempt: z.number().int().nonnegative(),
  output: z.string(),
  error: z.string().nullable(),
  started_at: epochMsSchema.nullable(),
  finished_at: epochMsSchema.nullable(),
  created_at: epochMsSchema,
});
export type TriggerRunRow = z.infer<typeof triggerRunRowSchema>;

/** action_key ごとのparams_jsonバリデーション。テンプレート変数は {{task.title}} 等のみ許可 */
export const hatchActionParamsSchemas = {
  claude_prompt: z.object({ template: z.string().min(1), output: z.enum(['note', 'push']) }),
  claude_subtasks: z.object({ max_count: z.number().int().positive().max(20) }),
  claude_summarize: z.object({}),
  create_task: z.object({
    list_id: idSchema,
    title_template: z.string().min(1),
    due_offset_days: z.number().int().optional(),
  }),
  create_note: z.object({ title_template: z.string(), body_template: z.string() }),
  add_tag: z.object({ tag_id: idSchema }),
  set_priority: z.object({ priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }),
  move_to_list: z.object({ list_id: idSchema }),
  push_notify: z.object({ title: z.string().min(1), body: z.string() }),
  discord_notify: z.object({ webhook_key: z.string().min(1), message_template: z.string().min(1) }),
  run_registered_script: z.object({ script_key: z.string().min(1) }),
} as const satisfies Record<HatchActionKey, z.ZodTypeAny>;

/** {{task.title}} {{task.note}} {{list.name}} {{task.due}} のみ展開する。任意の式評価は実装しない */
export const HATCH_TEMPLATE_VARS = ['task.title', 'task.note', 'list.name', 'task.due'] as const;
