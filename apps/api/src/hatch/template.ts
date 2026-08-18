import type Database from 'better-sqlite3';
import { fetchWeatherForecast, getUserWeatherLocation } from './weather.js';

interface TaskForTemplate {
  title: string;
  note: string;
  due_at: number | null;
  due_date: string | null;
  list_id: string;
}

/** JST基準の「今日」の年月日パーツを返す */
function todayPartsJst(): { y: string; m: string; d: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return {
    y: parts.find((p) => p.type === 'year')?.value ?? '1970',
    m: parts.find((p) => p.type === 'month')?.value ?? '01',
    d: parts.find((p) => p.type === 'day')?.value ?? '01',
  };
}

/** JST基準の「今日0時」のUTC epoch msを返す */
function todayStartMsJst(): number {
  const { y, m, d } = todayPartsJst();
  return Date.parse(`${y}-${m}-${d}T00:00:00+09:00`);
}

/** {{today.completed_tasks}}の中身：その日（JST）にユーザーが完了したタスクの箇条書き */
function todayCompletedTasksSummary(db: Database.Database, userId: string): string {
  const startMs = todayStartMsJst();
  const endMs = startMs + 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT title FROM tasks WHERE user_id = ? AND deleted_at IS NULL
       AND completed_at IS NOT NULL AND completed_at >= ? AND completed_at < ?
       ORDER BY completed_at ASC`,
    )
    .all(userId, startMs, endMs) as { title: string }[];

  if (rows.length === 0) return '（今日完了したタスクはありません）';
  return rows.map((r) => `- ${r.title}`).join('\n');
}

/** {{today.due_tasks}}の中身：今日期限（終日/時刻指定どちらも）でまだ完了していないタスクの箇条書き */
function todayDueTasksSummary(db: Database.Database, userId: string): string {
  const { y, m, d } = todayPartsJst();
  const todayDateStr = `${y}-${m}-${d}`;
  const startMs = todayStartMsJst();
  const endMs = startMs + 24 * 60 * 60 * 1000;
  const rows = db
    .prepare(
      `SELECT title FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND completed_at IS NULL
       AND ((due_at IS NOT NULL AND due_at >= ? AND due_at < ?) OR due_date = ?)
       ORDER BY due_at ASC`,
    )
    .all(userId, startMs, endMs, todayDateStr) as { title: string }[];

  if (rows.length === 0) return '（今日期限の未完了タスクはありません）';
  return rows.map((r) => `- ${r.title}`).join('\n');
}

/** {{weather.today_summary}}の中身：user_settings.weather_location_jsonに設定した地点の
 * 今日の天気概要（改修13回目：Hatchの発火条件を生活寄りに拡張） */
async function weatherTodaySummary(db: Database.Database, userId: string): Promise<string> {
  const location = getUserWeatherLocation(db, userId);
  if (!location) return '（天気を取得する地点が未設定です）';

  const forecast = await fetchWeatherForecast(location.lat, location.lon);
  if (!forecast) return '（天気情報を取得できませんでした）';

  return location.name ? `${location.name}: ${forecast.summary}` : forecast.summary;
}

/**
 * {{task.title}} {{task.note}} {{list.name}} {{task.due}} {{today.completed_tasks}}
 * {{today.due_tasks}} {{weather.today_summary}} のみ展開する。
 * 任意の式評価は実装しない（api-spec.md）。
 * taskIdはイベント発火の対象タスクがある時だけ渡される（scheduleイベント等では null）。
 * userIdはtoday系/weather系の集計に使う（改修13回目）。
 * weather.today_summaryはテンプレートが実際にその変数を参照する時だけ取得する
 * （無関係なトリガーの度に外部APIを叩かないため）
 */
export async function expandTemplate(
  db: Database.Database,
  template: string,
  taskId: string | null,
  userId?: string,
): Promise<string> {
  const values: Record<string, string> = {};

  if (taskId) {
    const task = db
      .prepare('SELECT title, note, due_at, due_date, list_id FROM tasks WHERE id = ?')
      .get(taskId) as TaskForTemplate | undefined;
    if (task) {
      const list = db.prepare('SELECT name FROM lists WHERE id = ?').get(task.list_id) as { name: string } | undefined;
      values['task.title'] = task.title;
      values['task.note'] = task.note;
      values['list.name'] = list?.name ?? '';
      values['task.due'] = task.due_date ?? (task.due_at !== null ? new Date(task.due_at).toISOString() : '');
    }
  }

  if (userId) {
    values['today.completed_tasks'] = todayCompletedTasksSummary(db, userId);
    values['today.due_tasks'] = todayDueTasksSummary(db, userId);
    if (/\{\{\s*weather\.today_summary\s*\}\}/.test(template)) {
      values['weather.today_summary'] = await weatherTodaySummary(db, userId);
    }
  }

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');
}
