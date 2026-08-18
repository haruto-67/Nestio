import type Database from 'better-sqlite3';
import { enqueueTriggerRun } from './queue.js';
import { fetchWeatherForecast, getUserWeatherLocation } from './weather.js';

interface TriggerRow {
  id: string;
  user_id: string;
  condition_json: string;
}

function wasRecentlyRun(db: Database.Database, triggerId: string, subjectId: string | null, sinceMs: number): boolean {
  const row = subjectId
    ? db
        .prepare('SELECT 1 FROM trigger_runs WHERE trigger_id = ? AND subject_id = ? AND created_at > ? LIMIT 1')
        .get(triggerId, subjectId, sinceMs)
    : db.prepare('SELECT 1 FROM trigger_runs WHERE trigger_id = ? AND created_at > ? LIMIT 1').get(triggerId, sinceMs);
  return row !== undefined;
}

/** 期限のN分前になったタスクを検知する。同じタスクへの重複発火は「offset*2分以内は再発火しない」で防ぐ */
export function checkDueSoonTriggers(db: Database.Database): void {
  const triggers = db
    .prepare(
      `SELECT id, user_id, condition_json FROM triggers WHERE event = 'due_soon' AND enabled = 1 AND deleted_at IS NULL`,
    )
    .all() as TriggerRow[];

  const now = Date.now();

  for (const trigger of triggers) {
    let condition: { offset_minutes?: number; list_id?: string };
    try {
      condition = JSON.parse(trigger.condition_json || '{}') as { offset_minutes?: number; list_id?: string };
    } catch {
      continue;
    }
    const offsetMs = (condition.offset_minutes ?? 30) * 60 * 1000;
    const windowEnd = now + offsetMs;

    const tasks = condition.list_id
      ? (db
          .prepare(
            `SELECT id FROM tasks WHERE user_id = ? AND list_id = ? AND deleted_at IS NULL AND completed_at IS NULL
             AND due_at IS NOT NULL AND due_at BETWEEN ? AND ?`,
          )
          .all(trigger.user_id, condition.list_id, now, windowEnd) as { id: string }[])
      : (db
          .prepare(
            `SELECT id FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND completed_at IS NULL
             AND due_at IS NOT NULL AND due_at BETWEEN ? AND ?`,
          )
          .all(trigger.user_id, now, windowEnd) as { id: string }[]);

    for (const task of tasks) {
      if (wasRecentlyRun(db, trigger.id, task.id, now - offsetMs * 2)) continue;
      enqueueTriggerRun(db, trigger.user_id, trigger.id, task.id);
    }
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 期限超過タスクを検知する。1日1回のみ発火（放置タスクの掘り起こし用途で十分な頻度） */
export function checkOverdueTriggers(db: Database.Database): void {
  const triggers = db
    .prepare(
      `SELECT id, user_id, condition_json FROM triggers WHERE event = 'overdue' AND enabled = 1 AND deleted_at IS NULL`,
    )
    .all() as TriggerRow[];

  const now = Date.now();

  for (const trigger of triggers) {
    let condition: { list_id?: string };
    try {
      condition = JSON.parse(trigger.condition_json || '{}') as { list_id?: string };
    } catch {
      continue;
    }

    const tasks = condition.list_id
      ? (db
          .prepare(
            `SELECT id FROM tasks WHERE user_id = ? AND list_id = ? AND deleted_at IS NULL AND completed_at IS NULL
             AND due_at IS NOT NULL AND due_at < ?`,
          )
          .all(trigger.user_id, condition.list_id, now) as { id: string }[])
      : (db
          .prepare(
            `SELECT id FROM tasks WHERE user_id = ? AND deleted_at IS NULL AND completed_at IS NULL
             AND due_at IS NOT NULL AND due_at < ?`,
          )
          .all(trigger.user_id, now) as { id: string }[]);

    for (const task of tasks) {
      if (wasRecentlyRun(db, trigger.id, task.id, now - DAY_MS)) continue;
      enqueueTriggerRun(db, trigger.user_id, trigger.id, task.id);
    }
  }
}

/** 「毎日/毎週の指定時刻」。condition_jsonは { hour, minute, weekday? }（weekdayは"Mon"等の3文字略称） */
export function checkScheduleTriggers(db: Database.Database): void {
  const triggers = db
    .prepare(
      `SELECT id, user_id, condition_json FROM triggers WHERE event = 'schedule' AND enabled = 1 AND deleted_at IS NULL`,
    )
    .all() as TriggerRow[];
  if (triggers.length === 0) return;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const now = Date.now();

  for (const trigger of triggers) {
    let condition: { hour?: number; minute?: number; weekday?: string };
    try {
      condition = JSON.parse(trigger.condition_json || '{}') as {
        hour?: number;
        minute?: number;
        weekday?: string;
      };
    } catch {
      continue;
    }
    if (condition.hour === undefined || condition.minute === undefined) continue;
    if (condition.hour !== hour || condition.minute !== minute) continue;
    if (condition.weekday && condition.weekday !== weekday) continue;

    // ポーリング間隔（30秒）より長い猶予を見て、同じ分内での重複発火を防ぐ
    if (wasRecentlyRun(db, trigger.id, null, now - 60_000)) continue;
    enqueueTriggerRun(db, trigger.user_id, trigger.id, null);
  }
}

/** 「指定時刻の降水確率がしきい値以上」。condition_jsonは
 * { hour, minute, min_precipitation_probability }（改修13回目：Hatchの発火条件を生活寄りに拡張）。
 * user_settings.weather_location_jsonに地点が未設定のユーザーは黙ってスキップする
 * （通知系アクションと違い、地点未設定は設定ミスというより「まだ使わない」選択として扱う） */
export async function checkWeatherTriggers(db: Database.Database): Promise<void> {
  const triggers = db
    .prepare(
      `SELECT id, user_id, condition_json FROM triggers WHERE event = 'weather_rain' AND enabled = 1 AND deleted_at IS NULL`,
    )
    .all() as TriggerRow[];
  if (triggers.length === 0) return;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const now = Date.now();

  for (const trigger of triggers) {
    let condition: { hour?: number; minute?: number; min_precipitation_probability?: number };
    try {
      condition = JSON.parse(trigger.condition_json || '{}') as {
        hour?: number;
        minute?: number;
        min_precipitation_probability?: number;
      };
    } catch {
      continue;
    }
    if (condition.hour === undefined || condition.minute === undefined) continue;
    if (condition.hour !== hour || condition.minute !== minute) continue;
    if (wasRecentlyRun(db, trigger.id, null, now - 60_000)) continue;

    const location = getUserWeatherLocation(db, trigger.user_id);
    if (!location) continue;

    const forecast = await fetchWeatherForecast(location.lat, location.lon);
    if (!forecast) continue;
    const threshold = condition.min_precipitation_probability ?? 50;
    if (forecast.precipitationProbability < threshold) continue;

    enqueueTriggerRun(db, trigger.user_id, trigger.id, null);
  }
}

export async function checkAllPeriodicTriggers(db: Database.Database): Promise<void> {
  checkDueSoonTriggers(db);
  checkOverdueTriggers(db);
  checkScheduleTriggers(db);
  await checkWeatherTriggers(db);
}
