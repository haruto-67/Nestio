/**
 * タスク一覧ヘッダー用の小さな線画アイコン（改修9回目）。BackgroundMarkと同じ
 * 線画スタイル（fill無し・currentColor・丸い線端）でLucideアイコンと違和感なく並ぶよう
 * 24x24のviewBoxに揃えている。
 */

interface IconProps {
  size?: number;
  className?: string;
}

/** 絞り込み：漏斗を線画で */
export function FilterIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 5h16l-6.5 7.5V18l-3 1.5v-7z" />
    </svg>
  );
}

/** 表示方法：BackgroundMarkと同じ巣（重なる楕円の輪）のモチーフ */
export function NestViewIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <ellipse cx="12" cy="15.5" rx="8" ry="3" />
      <ellipse cx="12" cy="13" rx="5.5" ry="2" />
      <path d="M5 15.5q0.5 -3 4 -4" />
      <path d="M19 15.5q-0.5 -3 -4 -4" />
    </svg>
  );
}
