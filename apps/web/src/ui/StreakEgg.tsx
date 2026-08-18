interface StreakEggProps {
  streak: number;
  size?: number;
  className?: string;
}

/**
 * 連続達成日数（ストリーク）を「卵が孵化していく」段階的な見た目で表現する
 * （改修13回目、改修9回目ブレインストーム「巣と卵のモチーフを活かした孵化する習慣
 * トラッキング」の実装）。BackgroundMark.tsxと同じ手描き線画スタイル（viewBox・stroke・
 * currentColorでの色指定）を踏襲する。
 * 1〜2回=卵のみ、3〜6回=ヒビが入る、7回以上=殻が割れてひよこが顔を出す、の3段階
 */
export function StreakEgg({ streak, size = 14, className = '' }: StreakEggProps) {
  const stage = streak >= 7 ? 3 : streak >= 3 ? 2 : 1;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {stage === 3 ? (
        <>
          {/* 割れた殻の下半分 */}
          <path d="M6 15 Q4 20 12 21 Q20 20 18 15" />
          {/* ひよこの頭 */}
          <circle cx="12" cy="10" r="6" />
          <circle cx="9.5" cy="9" r="0.8" fill="currentColor" stroke="none" />
          <path d="M12 11 L14.5 12 L12 12.5 Z" fill="currentColor" stroke="none" />
          {/* 殻の上半分の欠片 */}
          <path d="M5 8 L8 6" />
          <path d="M19 8 L16 6" />
        </>
      ) : (
        <>
          {/* 卵本体 */}
          <ellipse cx="12" cy="13" rx="7" ry="9" />
          {stage === 2 && <path d="M9 8 L11 12 L9.5 14 L12.5 18" strokeWidth="1.2" />}
        </>
      )}
    </svg>
  );
}
