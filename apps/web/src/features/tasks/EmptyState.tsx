import { Egg } from 'lucide-react';

/** タスクが1件も無い時の空状態。世界観（巣・卵）に寄せた軽い演出（改修4回目 UI改善案1） */
export function EmptyState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-neutral-400">
      <Egg size={36} className="text-amber-300 dark:text-amber-500" />
      <p className="text-sm">{message ?? 'タスクはありません。巣はまだ空っぽです'}</p>
    </div>
  );
}
