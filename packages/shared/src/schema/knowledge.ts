import { z } from 'zod';
import { idSchema, epochMsSchema, seqSchema } from './common.js';

const syncable = {
  created_at: epochMsSchema,
  updated_at: epochMsSchema,
  deleted_at: epochMsSchema.nullable(),
  seq: seqSchema,
};

export const knowledgeCategorySchema = z.enum(['profile', 'project', 'topic', 'person', 'decision']);
export type KnowledgeCategory = z.infer<typeof knowledgeCategorySchema>;

export const knowledgeRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  title: z.string().min(1),
  description: z.string(),
  body: z.string(),
  category: knowledgeCategorySchema,
  ...syncable,
});
export type KnowledgeRow = z.infer<typeof knowledgeRowSchema>;

export const knowledgeWritableFields = knowledgeRowSchema
  .omit({ id: true, user_id: true, created_at: true, updated_at: true, deleted_at: true, seq: true })
  .partial();
export type KnowledgeWritableFields = z.infer<typeof knowledgeWritableFields>;

/** タグは既存のtagsテーブルをタスクと共用する（task_tagsと同型の中間テーブル） */
export const knowledgeTagRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  knowledge_id: idSchema,
  tag_id: idSchema,
  ...syncable,
});
export type KnowledgeTagRow = z.infer<typeof knowledgeTagRowSchema>;

export const knowledgeTagWritableFields = z.object({ knowledge_id: idSchema, tag_id: idSchema }).partial();
export type KnowledgeTagWritableFields = z.infer<typeof knowledgeTagWritableFields>;

/** [[タイトル]]によるノート間リンク。to_idはリンク先がまだ存在しない場合null（改修24回目フォローアップで解決ロジックを実装予定） */
export const knowledgeLinkRowSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  from_id: idSchema,
  to_title: z.string(),
  to_id: idSchema.nullable(),
  ...syncable,
});
export type KnowledgeLinkRow = z.infer<typeof knowledgeLinkRowSchema>;
