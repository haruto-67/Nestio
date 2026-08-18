import { describe, expect, it, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList } from '../test-utils/db.js';
import { checkDueSoonTriggers, checkOverdueTriggers, checkScheduleTriggers, checkWeatherTriggers } from './periodic-events.js';

function insertTrigger(
  db: Database.Database,
  userId: string,
  event: string,
  conditionJson = '{}',
): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO triggers (id, user_id, name, event, condition_json, action_key, params_json, enabled, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, 'test trigger', ?, ?, 'push_notify', '{}', 1, ?, ?, NULL, 1)`,
  ).run(id, userId, event, conditionJson, Date.now(), Date.now());
  return id;
}

function insertTaskWithDueAt(db: Database.Database, userId: string, listId: string, dueAt: number): string {
  const taskId = uuidv7();
  db.prepare(
    `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, NULL, 'task', '', 0, ?, NULL, NULL, NULL, 1, ?, ?, NULL, 1)`,
  ).run(taskId, userId, listId, dueAt, Date.now(), Date.now());
  return taskId;
}

function queuedCount(db: Database.Database, triggerId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as c FROM trigger_runs WHERE trigger_id = ? AND status = 'queued'")
    .get(triggerId) as { c: number };
  return row.c;
}

describe('hatch periodic-events', () => {
  let db: Database.Database;
  let userId: string;
  let listId: string;

  afterEach(() => {
    db?.close();
    vi.unstubAllGlobals();
  });

  function setup() {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    listId = insertTestList(db, userId);
  }

  it('checkDueSoonTriggers: offset_minutes以内に期限が来るタスクを検知する', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'due_soon', JSON.stringify({ offset_minutes: 30 }));
    insertTaskWithDueAt(db, userId, listId, Date.now() + 10 * 60 * 1000);

    checkDueSoonTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(1);
  });

  it('checkDueSoonTriggers: 期限がoffsetより先のタスクは検知しない', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'due_soon', JSON.stringify({ offset_minutes: 30 }));
    insertTaskWithDueAt(db, userId, listId, Date.now() + 60 * 60 * 1000);

    checkDueSoonTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(0);
  });

  it('checkDueSoonTriggers: list_id条件で絞り込む', () => {
    setup();
    const otherListId = insertTestList(db, userId);
    const triggerId = insertTrigger(db, userId, 'due_soon', JSON.stringify({ offset_minutes: 30, list_id: otherListId }));
    insertTaskWithDueAt(db, userId, listId, Date.now() + 10 * 60 * 1000);

    checkDueSoonTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(0);
  });

  it('checkDueSoonTriggers: 直近に発火済みなら重複発火しない', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'due_soon', JSON.stringify({ offset_minutes: 30 }));
    insertTaskWithDueAt(db, userId, listId, Date.now() + 10 * 60 * 1000);

    checkDueSoonTriggers(db);
    checkDueSoonTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(1);
  });

  it('checkOverdueTriggers: 期限超過タスクを検知する', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'overdue');
    insertTaskWithDueAt(db, userId, listId, Date.now() - 60 * 60 * 1000);

    checkOverdueTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(1);
  });

  it('checkOverdueTriggers: 期限内のタスクは検知しない', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'overdue');
    insertTaskWithDueAt(db, userId, listId, Date.now() + 60 * 60 * 1000);

    checkOverdueTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(0);
  });

  it('checkScheduleTriggers: 現在時刻(Asia/Tokyo)と一致すると発火する', () => {
    setup();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

    const triggerId = insertTrigger(db, userId, 'schedule', JSON.stringify({ hour, minute }));

    checkScheduleTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(1);
  });

  it('checkScheduleTriggers: 現在時刻と一致しなければ発火しない', () => {
    setup();
    const triggerId = insertTrigger(db, userId, 'schedule', JSON.stringify({ hour: 4, minute: 20 }));
    // ほぼ確実に現在時刻と一致しない固定値。稀な一致を避けるため23:59以外を使う
    const now = new Date();
    if (now.getUTCHours() === 19 && now.getUTCMinutes() === 20) {
      // 4:20 JST == 19:20 UTC の前日。万一一致したら条件をずらす
      db.prepare('UPDATE triggers SET condition_json = ? WHERE id = ?').run(
        JSON.stringify({ hour: 4, minute: 21 }),
        triggerId,
      );
    }

    checkScheduleTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(0);
  });

  function currentJstHourMinute(): { hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    return {
      hour: Number(parts.find((p) => p.type === 'hour')?.value ?? '0'),
      minute: Number(parts.find((p) => p.type === 'minute')?.value ?? '0'),
    };
  }

  function insertUserWeatherLocation(db: Database.Database, userId: string, lat: number, lon: number): void {
    db.prepare(
      `INSERT INTO user_settings (user_id, theme, keymap_json, weather_location_json, updated_at, seq)
       VALUES (?, 'light', '{}', ?, ?, 1)`,
    ).run(userId, JSON.stringify({ lat, lon, name: 'テスト地点' }), Date.now());
  }

  it('checkWeatherTriggers: 時刻が一致し降水確率がしきい値以上なら発火する', async () => {
    setup();
    const { hour, minute } = currentJstHourMinute();
    insertUserWeatherLocation(db, userId, 35.68, 139.76);
    const triggerId = insertTrigger(
      db,
      userId,
      'weather_rain',
      JSON.stringify({ hour, minute, min_precipitation_probability: 50 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ daily: { precipitation_probability_max: [80], weathercode: [61] } }),
      }),
    );

    await checkWeatherTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(1);
  });

  it('checkWeatherTriggers: 降水確率がしきい値未満なら発火しない', async () => {
    setup();
    const { hour, minute } = currentJstHourMinute();
    // 別地点の座標を使い、直前のテストの天気キャッシュ（30分TTL）と衝突しないようにする
    insertUserWeatherLocation(db, userId, 34.0, 135.0);
    const triggerId = insertTrigger(
      db,
      userId,
      'weather_rain',
      JSON.stringify({ hour, minute, min_precipitation_probability: 50 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ daily: { precipitation_probability_max: [10], weathercode: [1] } }),
      }),
    );

    await checkWeatherTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(0);
  });

  it('checkWeatherTriggers: 地点が未設定のユーザーは発火しない（天気APIも呼ばない）', async () => {
    setup();
    const { hour, minute } = currentJstHourMinute();
    const triggerId = insertTrigger(
      db,
      userId,
      'weather_rain',
      JSON.stringify({ hour, minute, min_precipitation_probability: 50 }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await checkWeatherTriggers(db);

    expect(queuedCount(db, triggerId)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
