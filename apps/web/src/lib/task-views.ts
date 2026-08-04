import type { TaskRow } from '@nestio/shared';
import { epochMsToJstDateString } from './datetime.js';

/** タスクの期限をJST基準の暦日（YYYY-MM-DD）として取得する。期限なしはnull */
export function taskDueDateStringJst(task: TaskRow): string | null {
  if (task.due_date) return task.due_date;
  if (task.due_at !== null) return epochMsToJstDateString(task.due_at);
  return null;
}

/** 期限切れ（表示上の判定のみ。due_at/due_dateの実データは書き換えない） */
export function isOverdue(task: TaskRow, todayStr: string): boolean {
  if (task.completed_at !== null) return false;
  const d = taskDueDateStringJst(task);
  return d !== null && d < todayStr;
}

export function isDueOn(task: TaskRow, dateStr: string): boolean {
  return taskDueDateStringJst(task) === dateStr;
}

export function isDueInRange(task: TaskRow, startInclusive: string, endInclusive: string): boolean {
  const d = taskDueDateStringJst(task);
  return d !== null && d >= startInclusive && d <= endInclusive;
}

export type SmartListKey = 'today' | 'tomorrow' | 'week' | 'no_due' | 'all' | 'completed';

export const SMART_LISTS: { key: SmartListKey; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'tomorrow', label: '明日' },
  { key: 'week', label: '今週' },
  { key: 'no_due', label: '期限なし' },
  { key: 'all', label: 'すべて' },
  { key: 'completed', label: '完了済み' },
];

/**
 * スマートリストごとのさりげないアクセント。「今日」（Roost）だけでなく他のビューにも
 * 控えめな個性を持たせる（改修4回目 UI改善案5）。TailwindはクラスをJITでスキャンするため
 * テンプレートリテラルで色名を組み立てず、完全なクラス名の対応表として持つ
 */
export const SMART_LIST_DOT_CLASS: Record<SmartListKey, string> = {
  today: 'bg-amber-400',
  tomorrow: 'bg-sky-400',
  week: 'bg-violet-400',
  no_due: 'bg-neutral-300 dark:bg-neutral-600',
  all: 'bg-neutral-300 dark:bg-neutral-600',
  completed: 'bg-emerald-400',
};

export const SMART_LIST_HEADER_ACCENT_CLASS: Record<SmartListKey, string> = {
  today: 'border-t-amber-400',
  tomorrow: 'border-t-sky-400',
  week: 'border-t-violet-400',
  no_due: 'border-t-transparent',
  all: 'border-t-transparent',
  completed: 'border-t-emerald-400',
};
