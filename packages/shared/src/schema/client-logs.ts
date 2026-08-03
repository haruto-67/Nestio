import { z } from 'zod';
import { idSchema, epochMsSchema } from './common.js';

export const clientLogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type ClientLogLevel = z.infer<typeof clientLogLevelSchema>;

export const clientLogEntrySchema = z.object({
  level: clientLogLevelSchema,
  message: z.string().min(1),
  context: z.record(z.string(), z.unknown()).optional(),
  timestamp: epochMsSchema,
});
export type ClientLogEntry = z.infer<typeof clientLogEntrySchema>;

/** 端末側のリングバッファログをまとめて送信する。sync-protocol.md/api-spec.md 9章 */
export const clientLogsRequestSchema = z.object({
  device_id: idSchema,
  session_trace_id: z.string().min(1),
  entries: z.array(clientLogEntrySchema).min(1).max(500),
});
export type ClientLogsRequest = z.infer<typeof clientLogsRequestSchema>;
