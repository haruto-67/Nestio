import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';

export const pushSubscriptionRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  device_id: idSchema.nullable(),
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  created_at: epochMsSchema,
});
export type PushSubscriptionRow = z.infer<typeof pushSubscriptionRowSchema>;

export const pushSubscribeRequestSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequestSchema>;

export const scheduledPushKindSchema = z.enum(['due_reminder', 'pomodoro']);
export type ScheduledPushKind = z.infer<typeof scheduledPushKindSchema>;

export const scheduledPushRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  kind: scheduledPushKindSchema,
  task_id: idSchema.nullable(),
  fire_at: epochMsSchema,
  title: z.string().min(1),
  body: z.string(),
  sent_at: epochMsSchema.nullable(),
  canceled_at: epochMsSchema.nullable(),
  created_at: epochMsSchema,
});
export type ScheduledPushRow = z.infer<typeof scheduledPushRowSchema>;

export const pomodoroScheduleRequestSchema = z.object({
  duration_sec: z.number().int().positive(),
  task_id: idSchema.optional(),
});
export type PomodoroScheduleRequest = z.infer<typeof pomodoroScheduleRequestSchema>;
