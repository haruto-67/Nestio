const TOKYO_TZ = 'Asia/Tokyo';

/** 自然順ソート（"01." のようなインデックス運用で 10 が 2 より前に来ないようにする） */
export const naturalCollator = new Intl.Collator(undefined, { numeric: true });

export function formatDateTimeJst(epochMs: number): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TOKYO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs));
}

export function formatDateJst(epochMs: number): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: TOKYO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

/** 現在の日本時間での日付文字列（YYYY-MM-DD）。sv-SEロケールがこの形式を返す */
export function todayJstDateString(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TOKYO_TZ }).format(new Date());
}

export function epochMsToJstDateString(epochMs: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TOKYO_TZ }).format(new Date(epochMs));
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** dateStr（YYYY-MM-DD, JST基準の暦日）が属する週の月曜日と日曜日を返す */
export function weekRangeOf(dateStr: string): { monday: string; sunday: string } {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=日, 1=月, ...
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = addDaysToDateString(dateStr, diffToMonday);
  const sunday = addDaysToDateString(monday, 6);
  return { monday, sunday };
}
