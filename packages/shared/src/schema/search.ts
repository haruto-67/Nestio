import { z } from 'zod';
import { idSchema } from './common.js';

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchTaskResultSchema = z.object({
  id: idSchema,
  title: z.string(),
  snippet: z.string(),
  list_id: idSchema,
});
export type SearchTaskResult = z.infer<typeof searchTaskResultSchema>;

export const searchNoteResultSchema = z.object({
  id: idSchema,
  title: z.string(),
  snippet: z.string(),
});
export type SearchNoteResult = z.infer<typeof searchNoteResultSchema>;

export const searchResponseSchema = z.object({
  tasks: z.array(searchTaskResultSchema),
  notes: z.array(searchNoteResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
