import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';

export const userRowSchema = z.object({
  id: idSchema,
  google_sub: z.string().min(1),
  email: z.string().email(),
  display_name: z.string().min(1),
  avatar_url: z.string().url().nullable(),
  created_at: epochMsSchema,
});
export type UserRow = z.infer<typeof userRowSchema>;

export const syncStateRowSchema = z.object({
  user_id: idSchema,
  last_seq: z.number().int().nonnegative(),
});
export type SyncStateRow = z.infer<typeof syncStateRowSchema>;

export const deviceRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  label: z.string().min(1),
  last_seen: epochMsSchema,
  created_at: epochMsSchema,
});
export type DeviceRow = z.infer<typeof deviceRowSchema>;

export const sessionRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  device_id: idSchema.nullable(),
  expires_at: epochMsSchema,
  created_at: epochMsSchema,
});
export type SessionRow = z.infer<typeof sessionRowSchema>;
