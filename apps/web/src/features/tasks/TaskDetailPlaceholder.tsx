import { BackgroundMark } from '../../ui/BackgroundMark.js';

/**
 * タスク詳細パネル未選択時に表示する空きスペース（改修6回目）。パネルの開閉で
 * タスク一覧の幅が変わらないよう、選択中と同じ幅ぶんの領域を常に確保しておく
 */
export function TaskDetailPlaceholder() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center border-l border-neutral-200 bg-neutral-950 dark:border-neutral-800">
      <BackgroundMark className="h-40 w-40 opacity-60" />
    </div>
  );
}
