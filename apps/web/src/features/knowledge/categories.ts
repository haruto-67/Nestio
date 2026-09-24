import type { KnowledgeCategory } from '@nestio/shared';

/** 要件定義の並び順（プロフィール→プロジェクト→トピック→人物→判断）を一覧のグルーピング順にも使う */
export const CATEGORY_ORDER: KnowledgeCategory[] = ['profile', 'project', 'topic', 'person', 'decision'];

export const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  profile: 'プロフィール',
  project: 'プロジェクト',
  topic: 'トピック',
  person: '人物',
  // 複数の選択肢から1つを選んだ判断とその理由（記憶規約ナレッジ、改修24回目フォローアップ）
  decision: '判断',
};
