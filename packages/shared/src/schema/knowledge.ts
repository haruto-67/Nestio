import { z } from 'zod';

/**
 * ナレッジのcategory（frontmatterの値）。改修25回目でナレッジ本体はObsidian形式のVaultへ移り、
 * DBの行スキーマ（knowledge / knowledge_tags / knowledge_links）は撤去した（docs/vault-spec.md）
 */
export const knowledgeCategorySchema = z.enum(['profile', 'project', 'topic', 'person', 'decision']);
export type KnowledgeCategory = z.infer<typeof knowledgeCategorySchema>;
