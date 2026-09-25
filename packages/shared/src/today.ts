/**
 * 「今日」タブの対象・並び順・達成数の判定（改修26回目）。
 * Web の「今日」タブと、iPad ダッシュボード向け API（GET /api/v1/dashboard/today）の両方が
 * これを使う。API 専用の別ルールを作らず、タブの仕様が変わればそのまま API も追従させるため
 */

const TOKYO_TZ = 'Asia/Tokyo';
const jstDateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: TOKYO_TZ });

/** 判定に必要な列だけを持つ形（Web の TaskRow も API の SELECT 結果もこれを満たす） */
export interface TodayTaskFields {
  due_at: number | null;
  due_date: string | null;
  completed_at: number | null;
  sort_order: number;
}

/** epoch ms を日本時間の暦日（YYYY-MM-DD）にする。sv-SE ロケールがこの形式を返す */
export function epochMsToJstDateString(epochMs: number): string {
  return jstDateFormatter.format(new Date(epochMs));
}

/** 日本時間での今日（YYYY-MM-DD） */
export function todayJstDateString(now: number = Date.now()): string {
  return epochMsToJstDateString(now);
}

/** タスクの期限を JST 基準の暦日として取得する。期限なしは null */
export function taskDueDateStringJst(task: Pick<TodayTaskFields, 'due_at' | 'due_date'>): string | null {
  if (task.due_date) return task.due_date;
  if (task.due_at !== null) return epochMsToJstDateString(task.due_at);
  return null;
}

/** 期限切れ（表示上の判定のみ。due_at/due_date の実データは書き換えない） */
export function isOverdue(task: TodayTaskFields, todayStr: string): boolean {
  if (task.completed_at !== null) return false;
  const d = taskDueDateStringJst(task);
  return d !== null && d < todayStr;
}

function isDueOnOrBefore(task: TodayTaskFields, todayStr: string): boolean {
  const d = taskDueDateStringJst(task);
  return d !== null && d <= todayStr;
}

/** 「今日」タブに出るタスク：未完了で、期限が今日以前（期限切れは今日に表示上だけ繰り越す） */
export function isInTodayView(task: TodayTaskFields, todayStr: string): boolean {
  return task.completed_at === null && isDueOnOrBefore(task, todayStr);
}

/**
 * 「今日」タブ見出しの「X/Y 完了」。タブ自体は未完了しか出さないため、
 * 完了数は「期限が今日以前」の全タスク（完了済みを含む）から集計する
 */
export function todayCompletionStats(tasks: TodayTaskFields[], todayStr: string): { completed: number; total: number } {
  const relevant = tasks.filter((t) => isDueOnOrBefore(t, todayStr));
  return { completed: relevant.filter((t) => t.completed_at !== null).length, total: relevant.length };
}

/** 期限順（'due'）の比較。完了済みは常に末尾、期限なしは期限ありの後ろ、同じ日は元の順を保つ */
export function compareTasksByDue(a: TodayTaskFields, b: TodayTaskFields): number {
  // 完了済みは常に末尾（期限の近さより「もう終わっている」ことを優先して見せる）
  const ca = a.completed_at !== null;
  const cb = b.completed_at !== null;
  if (ca !== cb) return ca ? 1 : -1;

  const da = taskDueDateStringJst(a);
  const db = taskDueDateStringJst(b);
  if (da === null && db === null) return a.sort_order - b.sort_order;
  if (da === null) return 1;
  if (db === null) return -1;
  return da < db ? -1 : da > db ? 1 : 0;
}
