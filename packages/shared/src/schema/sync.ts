import { z } from 'zod';
import { idSchema, epochMsSchema, seqSchema } from './common.js';

export const appliedOpRowSchema = z.object({
  op_id: idSchema,
  user_id: idSchema,
  applied_at: epochMsSchema,
  result_seq: seqSchema,
});
export type AppliedOpRow = z.infer<typeof appliedOpRowSchema>;

/** /sync/push 対象テーブル名。ここに無いテーブルは書き込み経路として認めない */
export const syncableTableSchema = z.enum([
  'folders',
  'lists',
  'tasks',
  'tags',
  'task_tags',
  'notes',
  'attachments',
  'triggers',
  'user_settings',
]);
export type SyncableTable = z.infer<typeof syncableTableSchema>;

export const syncOpSchema = z.object({
  op_id: idSchema,
  table: syncableTableSchema,
  id: idSchema,
  op: z.enum(['upsert', 'delete']),
  updated_at: epochMsSchema,
  fields: z.record(z.string(), z.unknown()),
});
export type SyncOp = z.infer<typeof syncOpSchema>;

export const syncPushRequestSchema = z.object({
  device_id: idSchema,
  ops: z.array(syncOpSchema).min(1).max(200),
});
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

export const syncRejectReasonSchema = z.enum([
  'forbidden',
  'cycle_detected',
  'parent_incomplete',
  'validation_failed',
  'quota_exceeded',
]);
export type SyncRejectReason = z.infer<typeof syncRejectReasonSchema>;

export const syncPushResponseSchema = z.object({
  applied: z.array(idSchema),
  rejected: z.array(z.object({ op_id: idSchema, reason: syncRejectReasonSchema })),
  next_seq: z.number().int().nonnegative(),
  clock_skew_ms: z.number().int().optional(),
});
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

export const syncPullQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(500).default(500),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export const syncPullResponseSchema = z.object({
  changes: z.record(syncableTableSchema, z.array(z.record(z.string(), z.unknown()))),
  next_seq: z.number().int().nonnegative(),
  has_more: z.boolean(),
  full_resync_required: z.boolean().optional(),
});
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
