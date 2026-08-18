import { RRule, rrulestr } from 'rrule';
import { todayJstDateString } from './datetime.js';

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly';

export const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'] as const;
/** rrule.js の weekday 定数（0=月 ... 6=日）に対応させたインデックス */
const RRULE_WEEKDAYS = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];

function dateOnlyToUtcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function utcDateToDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 繰り返し設定時、現在のdue_at/due_dateをDTSTARTとしてRRULE文字列を組み立てる。
 * DTSTARTを含めた文字列を保存することで、以後「元の予定日基準」の計算を維持できる。
 * 終日タスクはUTC正午基準ではなくUTC日付そのもの（時刻境界のズレを避けるため常にDate.UTC(y,m,d)を使う）。
 */
export function buildRruleString(
  freq: RecurrenceFreq,
  weekdayIndexes: number[] | undefined,
  dueAt: number | null,
  dueDate: string | null,
): string {
  const dtstart = dueAt !== null ? new Date(dueAt) : dueDate !== null ? dateOnlyToUtcDate(dueDate) : new Date();

  const rruleFreq = freq === 'daily' ? RRule.DAILY : freq === 'weekly' ? RRule.WEEKLY : RRule.MONTHLY;
  const rule = new RRule({
    freq: rruleFreq,
    dtstart,
    byweekday:
      weekdayIndexes && weekdayIndexes.length > 0
        ? weekdayIndexes.map((i) => RRULE_WEEKDAYS[i]).filter((w) => w !== undefined)
        : undefined,
  });

  return rule.toString();
}

/**
 * 完了時に次のoccurrenceを計算する。
 * 「元の予定日基準」＝ RRULE文字列に含まれるDTSTARTを固定したまま計算する（ズラさない）。
 * 「サボった分は溜めない・直近1件のみ」＝ 現在時刻より後で最初にマッチする日を返す
 * （何日分溜まっていても1回のafter()呼び出しで済むため、蓄積しない）。
 */
export function computeNextOccurrence(
  rruleString: string,
  isAllDay: boolean,
): { dueAt: number | null; dueDate: string | null } | null {
  const rule = rrulestr(rruleString);
  const now = isAllDay ? dateOnlyToUtcDate(todayJstDateString()) : new Date();
  const next = rule.after(now, false);
  if (!next) return null;

  return isAllDay ? { dueAt: null, dueDate: utcDateToDateOnly(next) } : { dueAt: next.getTime(), dueDate: null };
}

/**
 * 指定した期限（dueAt/dueDate）より後の次のoccurrenceを計算する（改修13回目：カレンダーの
 * 「孵化予報」用。computeNextOccurrenceは常に「現在時刻」を基準にするため、
 * 「今の期限の、その次」を知りたい場合には使えない。基準を明示的に渡せるようにする）
 */
export function computeOccurrenceAfter(
  rruleString: string,
  isAllDay: boolean,
  afterDueAt: number | null,
  afterDueDate: string | null,
): { dueAt: number | null; dueDate: string | null } | null {
  const rule = rrulestr(rruleString);
  const after = isAllDay
    ? dateOnlyToUtcDate(afterDueDate ?? todayJstDateString())
    : new Date(afterDueAt ?? Date.now());
  const next = rule.after(after, false);
  if (!next) return null;

  return isAllDay ? { dueAt: null, dueDate: utcDateToDateOnly(next) } : { dueAt: next.getTime(), dueDate: null };
}

/** UI表示用に人が読める形へ簡略化する（カスタムRRULEはそのまま返す） */
export function describeRrule(rruleString: string): string {
  try {
    const rule = rrulestr(rruleString);
    if (rule instanceof RRule) return rule.toText();
    return rruleString;
  } catch {
    return rruleString;
  }
}
