import type { KnowledgeCategory, KnowledgeRow } from '@nestio/shared';
import { parseLinkedTitles } from '@nestio/shared';

/** 要件定義の並び順（プロフィール→プロジェクト→トピック→人物）を一覧のグルーピング順にも使う */
export const CATEGORY_ORDER: KnowledgeCategory[] = ['profile', 'project', 'topic', 'person'];

export const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  profile: 'プロフィール',
  project: 'プロジェクト',
  topic: 'トピック',
  person: '人物',
};

/**
 * 指定ナレッジへの[[リンク]]を含む他ナレッジ一覧（バックリンク）を、ローカルIndexedDBにある
 * 全ナレッジのbodyをその都度パースして求める（改修24回目フォローアップ）。
 * サーバー側のknowledge_linksは同期対象にしていないため、CLAUDE.md絶対原則4
 * 「UIはIndexedDBだけを読む」に沿ってクライアント側だけで計算する
 */
export function computeBacklinks(all: KnowledgeRow[], target: KnowledgeRow): KnowledgeRow[] {
  return all.filter((k) => k.id !== target.id && parseLinkedTitles(k.body).includes(target.title));
}
