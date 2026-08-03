import { z } from 'zod';
import { idSchema, epochMsSchema, seqSchema } from './common.js';

export const themeSchema = z.enum(['dark', 'light']);
export type Theme = z.infer<typeof themeSchema>;

/** キー操作名 -> 割り当てキー文字列（例: "quick_add" -> "n"） */
export const keymapSchema = z.record(z.string(), z.string());
export type Keymap = z.infer<typeof keymapSchema>;

export const userSettingsRowSchema = z.object({
  user_id: idSchema,
  theme: themeSchema,
  keymap_json: z.string(),
  updated_at: epochMsSchema,
  seq: seqSchema,
});
export type UserSettingsRow = z.infer<typeof userSettingsRowSchema>;

export const userSettingsWritableFields = userSettingsRowSchema
  .omit({ user_id: true, updated_at: true, seq: true })
  .partial();
export type UserSettingsWritableFields = z.infer<typeof userSettingsWritableFields>;
