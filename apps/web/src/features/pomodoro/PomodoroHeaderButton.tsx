import { Timer } from 'lucide-react';
import { usePersistedPomodoroState } from './usePersistedPomodoroState.js';

interface PomodoroHeaderButtonProps {
  onClick: () => void;
  size: number;
  className: string;
}

/**
 * ヘッダー/サイドバーのポモドーロ起動ボタン（改修13回目：残り時間の常時ミニ表示）。
 * 実行中でない時は従来通りアイコンのみ。改修12回目でモバイルヘッダーの幅が
 * ぎりぎりになった教訓があるため、常に幅を取る表示にはせず、実行中だけmm:ssを
 * 添えて幅が伸びる形にする（普段は今までと同じ見た目・省スペースのまま）
 */
export function PomodoroHeaderButton({ onClick, size, className }: PomodoroHeaderButtonProps) {
  const { running, remainingSec } = usePersistedPomodoroState();
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  const remainingLabel = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <button
      onClick={onClick}
      title={running ? `ポモドーロ実行中：残り${remainingLabel}` : 'ポモドーロ'}
      className={`flex items-center gap-1 ${className}`}
    >
      <Timer size={size} />
      {running && <span className="font-mono text-xs tabular-nums">{remainingLabel}</span>}
    </button>
  );
}
