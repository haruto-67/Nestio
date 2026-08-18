import { describe, expect, it, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import { expandTemplate } from './template.js';

describe('expandTemplate', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
    vi.unstubAllGlobals();
  });

  it('task.title / list.nameを展開する', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = insertTestTask(db, userId, listId, 'テストタスク');

    const result = await expandTemplate(db, '{{task.title}} in {{list.name}}', taskId);

    expect(result).toBe('テストタスク in Inbox');
  });

  it('taskIdがnullなら全プレースホルダを空文字にする', async () => {
    db = createTestDb();
    const result = await expandTemplate(db, 'hello {{task.title}} world', null);
    expect(result).toBe('hello  world');
  });

  it('存在しないtaskIdでもエラーにならず空文字になる', async () => {
    db = createTestDb();
    const result = await expandTemplate(db, '{{task.title}}', uuidv7());
    expect(result).toBe('');
  });

  it('due_dateがある場合はdue_atより優先される', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = uuidv7();
    db.prepare(
      `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, ?, NULL, 't', '', 0, NULL, '2026-01-01', NULL, NULL, 1, ?, ?, NULL, 1)`,
    ).run(taskId, userId, listId, Date.now(), Date.now());

    const result = await expandTemplate(db, '{{task.due}}', taskId);

    expect(result).toBe('2026-01-01');
  });

  it('today.completed_tasksは今日完了したタスクを箇条書きで展開する', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const now = Date.now();
    const doneId = uuidv7();
    db.prepare(
      `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, ?, NULL, '今日完了したタスク', '', 0, NULL, NULL, NULL, ?, 1, ?, ?, NULL, 1)`,
    ).run(doneId, userId, listId, now, now, now);
    // 未完了タスクは一覧に含まれないことも確認する
    insertTestTask(db, userId, listId, '未完了タスク');

    const result = await expandTemplate(db, '{{today.completed_tasks}}', null, userId);

    expect(result).toBe('- 今日完了したタスク');
  });

  it('today.completed_tasksは対象タスクが無いイベント（scheduleイベント等）でも展開する', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);

    const result = await expandTemplate(db, '{{today.completed_tasks}}', null, userId);

    expect(result).toBe('（今日完了したタスクはありません）');
  });

  it('userIdを渡さない場合today.completed_tasksは空文字になる（後方互換）', async () => {
    db = createTestDb();
    const result = await expandTemplate(db, '{{today.completed_tasks}}', null);
    expect(result).toBe('');
  });

  it('today.due_tasksは今日期限の未完了タスクを箇条書きで展開する（終日・時刻指定どちらも対象）', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const now = Date.now();
    const dueDateId = uuidv7();
    const todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
    db.prepare(
      `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, ?, NULL, '今日期限タスク', '', 0, NULL, ?, NULL, NULL, 1, ?, ?, NULL, 1)`,
    ).run(dueDateId, userId, listId, todayDateStr, now, now);
    // 完了済みタスクは一覧に含まれないことも確認する
    const completedId = uuidv7();
    db.prepare(
      `INSERT INTO tasks (id, user_id, list_id, parent_id, title, note, priority, due_at, due_date, rrule, completed_at, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, ?, NULL, '完了済みタスク', '', 0, NULL, ?, NULL, ?, 1, ?, ?, NULL, 1)`,
    ).run(completedId, userId, listId, todayDateStr, now, now, now);

    const result = await expandTemplate(db, '{{today.due_tasks}}', null, userId);

    expect(result).toBe('- 今日期限タスク');
  });

  it('weather.today_summaryは地点未設定なら未設定である旨を返す', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);

    const result = await expandTemplate(db, '{{weather.today_summary}}', null, userId);

    expect(result).toBe('（天気を取得する地点が未設定です）');
  });

  it('weather.today_summaryは地点が設定済みなら天気APIの結果を展開する', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    db.prepare(
      `INSERT INTO user_settings (user_id, theme, keymap_json, weather_location_json, updated_at, seq)
       VALUES (?, 'light', '{}', ?, ?, 1)`,
    ).run(userId, JSON.stringify({ lat: 35.68, lon: 139.76, name: '自宅' }), Date.now());

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ daily: { precipitation_probability_max: [80], weathercode: [61] } }),
      }),
    );

    const result = await expandTemplate(db, '{{weather.today_summary}}', null, userId);

    expect(result).toBe('自宅: 弱い雨・降水確率80%');
  });

  it('テンプレートがweather.today_summaryを参照しない時は天気APIを呼ばない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    db.prepare(
      `INSERT INTO user_settings (user_id, theme, keymap_json, weather_location_json, updated_at, seq)
       VALUES (?, 'light', '{}', ?, ?, 1)`,
    ).run(userId, JSON.stringify({ lat: 35.68, lon: 139.76, name: '自宅' }), Date.now());

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expandTemplate(db, '{{today.completed_tasks}}', null, userId);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未知のプレースホルダは空文字になる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = insertTestTask(db, userId, listId, 't');

    const result = await expandTemplate(db, '{{unknown.key}}', taskId);

    expect(result).toBe('');
  });
});
