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
