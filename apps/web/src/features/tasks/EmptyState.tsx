import { Egg, Sunrise, CalendarDays, Feather, LayoutGrid, PartyPopper } from 'lucide-react';
import type { ViewSelection } from '../../state/view.js';
import { SMART_LIST_EMPTY_ICON_CLASS, type SmartListKey } from '../../lib/task-views.js';

const SMART_LIST_EMPTY_ICON: Record<SmartListKey, typeof Egg> = {
  today: Egg,
  tomorrow: Sunrise,
  week: CalendarDays,
  no_due: Feather,
  all: LayoutGrid,
  completed: PartyPopper,
};

interface EmptyStateProps {
  message?: string;
  /** スマートリストの種類に応じてマーク・色を変える。list/customビュー、または未指定の
   * 場合は既定（Egg・amber）のまま（改修13回目：空状態が全ビュー共通で単色だったのを
   * ビューごとに色分けする要望への対応） */
  view?: ViewSelection;
}

/** タスクが1件も無い時の空状態。世界観（巣・卵）に寄せた軽い演出（改修4回目 UI改善案1） */
export function EmptyState({ message, view }: EmptyStateProps) {
  const key: SmartListKey = view?.type === 'smart' ? view.key : 'today';
  const Icon = SMART_LIST_EMPTY_ICON[key];
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-neutral-400">
      <Icon size={36} className={SMART_LIST_EMPTY_ICON_CLASS[key]} />
      <p className="text-sm">{message ?? 'タスクはありません。巣はまだ空っぽです'}</p>
    </div>
  );
}
