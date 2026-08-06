/**
 * 空白スペース用の控えめな線画イラスト（改修6回目）。TickTickの空状態画面を参考に、
 * 巣（ナビ）と卵（Egg）のモチーフを線画で配置する。装飾用途のみでクリック不可・
 * 読み上げ不可（aria-hidden）にする
 */
export function BackgroundMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 240"
      aria-hidden="true"
      className={`pointer-events-none select-none text-neutral-300 dark:text-neutral-700 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 巣（重なる楕円の輪） */}
      <ellipse cx="120" cy="150" rx="70" ry="26" />
      <ellipse cx="120" cy="142" rx="52" ry="18" />
      <path d="M56 150 Q60 128 90 122" />
      <path d="M184 150 Q180 128 150 122" />

      {/* 卵 */}
      <ellipse cx="118" cy="96" rx="26" ry="34" />
      <path d="M106 88 Q118 82 128 90" strokeWidth="1.2" opacity="0.6" />

      {/* チェックマーク（達成のモチーフ） */}
      <path d="M170 60 L178 68 L194 48" strokeWidth="1.4" />

      {/* きらめき */}
      <path d="M52 70 L52 78 M48 74 L56 74" strokeWidth="1.2" />
      <path d="M196 110 L196 116 M193 113 L199 113" strokeWidth="1.2" />
      <circle cx="70" cy="40" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="205" cy="70" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="40" cy="130" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
