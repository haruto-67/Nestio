import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7, type DashboardPomodoro, type DashboardResponse, type DashboardToday } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { issueApiKey, revokeApiKey } from '../api-keys/keys.js';
import { schedulePomodoroPush, cancelScheduledPush } from '../push/scheduler.js';
import { getDashboardToday, toJstIso } from '../dashboard/dashboard.js';

function setupApp(db: Database.Database, extraEnv: Record<string, string> = {}) {
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', ...extraEnv } as unknown as NodeJS.ProcessEnv);
  return createApp(env, db, createLogger(env));
}

const DAY = 24 * 60 * 60 * 1000;
// 2026-09-26 12:00 JST
const NOW = Date.parse('2026-09-26T12:00:00+09:00');

function setDue(db: Database.Database, taskId: string, due: { due_at?: number; due_date?: string }) {
  db.prepare('UPDATE tasks SET due_at = ?, due_date = ? WHERE id = ?').run(due.due_at ?? null, due.due_date ?? null, taskId);
}

describe('dashboard api（改修26回目）', () => {
  let db: Database.Database;
  afterEach(() => db?.close());

  function setup() {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    return { userId, listId };
  }

  it('「今日」タブと同じく、期限が今日以前の未完了を期限順に返し、達成数は完了済みも含めて数える', () => {
    const { userId, listId } = setup();
    const todayTimed = insertTestTask(db, userId, listId, '今日18時');
    setDue(db, todayTimed, { due_at: Date.parse('2026-09-26T18:00:00+09:00') });
    const overdue = insertTestTask(db, userId, listId, '期限切れ');
    setDue(db, overdue, { due_date: '2026-09-24' });
    const todayAllDay = insertTestTask(db, userId, listId, '今日終日');
    setDue(db, todayAllDay, { due_date: '2026-09-26' });
    const doneToday = insertTestTask(db, userId, listId, '完了済み');
    setDue(db, doneToday, { due_date: '2026-09-26' });
    db.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').run(NOW - 60_000, doneToday);
    const tomorrow = insertTestTask(db, userId, listId, '明日');
    setDue(db, tomorrow, { due_date: '2026-09-27' });
    insertTestTask(db, userId, listId, '期限なし');
    const deleted = insertTestTask(db, userId, listId, '削除済み');
    setDue(db, deleted, { due_date: '2026-09-26' });
    db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(NOW, deleted);
    // 深夜0時直前(UTCでは前日)の時刻指定もJSTの暦日で判定する
    const lateNight = insertTestTask(db, userId, listId, '昨日23時半');
    setDue(db, lateNight, { due_at: Date.parse('2026-09-25T23:30:00+09:00') });

    const today = getDashboardToday(db, userId, NOW);

    expect(today.date).toBe('2026-09-26');
    expect(today.tasks.map((t) => t.title)).toEqual(['期限切れ', '昨日23時半', '今日18時', '今日終日']);
    expect(today.done_count).toBe(1);
    expect(today.total_count).toBe(5);
    const timed = today.tasks.find((t) => t.title === '今日18時')!;
    expect(timed).toMatchObject({ due_at: '2026-09-26T18:00:00+09:00', due_date: null, done: false, completed_at: null, overdue: false, list_id: listId });
    expect(today.tasks.find((t) => t.title === '期限切れ')).toMatchObject({ due_at: null, due_date: '2026-09-24', overdue: true });
  });

  it('共有を受けているリストのタスクも含め、他人のタスクは含めない', () => {
    const { userId } = setup();
    const ownerId = uuidv7();
    insertTestUser(db, ownerId);
    const sharedList = insertTestList(db, ownerId);
    const privateList = insertTestList(db, ownerId);
    db.prepare(
      `INSERT INTO list_shares (id, list_id, owner_user_id, invited_user_id, invited_email, status, created_at, accepted_at)
       VALUES (?, ?, ?, ?, 'x@example.com', 'accepted', ?, ?)`,
    ).run(uuidv7(), sharedList, ownerId, userId, NOW, NOW);
    const shared = insertTestTask(db, ownerId, sharedList, '共有リストの今日');
    setDue(db, shared, { due_date: '2026-09-26' });
    const other = insertTestTask(db, ownerId, privateList, '他人の今日');
    setDue(db, other, { due_date: '2026-09-26' });

    expect(getDashboardToday(db, userId, NOW).tasks.map((t) => t.title)).toEqual(['共有リストの今日']);
  });

  it('ダッシュボード用キーで今日・ポモドーロ・まとめ版を取得でき、ポモドーロは中断で null になる', async () => {
    const { userId, listId } = setup();
    const taskId = insertTestTask(db, userId, listId, '集中する作業');
    setDue(db, taskId, { due_date: '2020-01-01' });
    const { key } = issueApiKey(db, userId, 'iPad', 'dashboard');
    const app = setupApp(db);
    const auth = { Authorization: `Bearer ${key}` };

    const todayRes = await app.request('/api/v1/dashboard/today', { headers: auth });
    expect(todayRes.status).toBe(200);
    const today = (await todayRes.json()) as DashboardToday;
    expect(today.tasks.map((t) => t.title)).toEqual(['集中する作業']);

    const noneRes = await app.request('/api/v1/pomodoro/current', { headers: auth });
    expect(noneRes.status).toBe(200);
    expect(await noneRes.json()).toBeNull();

    const scheduleId = schedulePomodoroPush(db, userId, 25 * 60, taskId);
    const pomodoro = (await (await app.request('/api/v1/pomodoro/current', { headers: auth })).json()) as DashboardPomodoro;
    expect(pomodoro).toMatchObject({ task_id: taskId, task_title: '集中する作業', phase: 'focus', duration_sec: 1500, paused: false, round: null });
    expect(Date.parse(pomodoro.ends_at) - Date.parse(pomodoro.started_at)).toBe(1500 * 1000);

    const all = (await (await app.request('/api/v1/dashboard', { headers: auth })).json()) as DashboardResponse;
    expect(all.today.total_count).toBe(1);
    expect(all.pomodoro?.task_id).toBe(taskId);
    expect(all.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);

    cancelScheduledPush(db, userId, scheduleId);
    expect(await (await app.request('/api/v1/pomodoro/current', { headers: auth })).json()).toBeNull();

    schedulePomodoroPush(db, userId, 5 * 60, null);
    const rest = (await (await app.request('/api/v1/pomodoro/current', { headers: auth })).json()) as DashboardPomodoro;
    expect(rest).toMatchObject({ phase: 'break', task_id: null, task_title: null });
  });

  it('キー無し・無効・失効は401、ダッシュボード用キーで公開APIは403', async () => {
    const { userId } = setup();
    const { id, key } = issueApiKey(db, userId, 'iPad', 'dashboard');
    const app = setupApp(db);

    expect((await app.request('/api/v1/dashboard')).status).toBe(401);
    expect((await app.request('/api/v1/pomodoro/current')).status).toBe(401);
    expect((await app.request('/api/v1/dashboard', { headers: { Authorization: 'Bearer nestio_sk_bogus' } })).status).toBe(401);

    const publicRes = await app.request('/api/v1/public/tasks', { headers: { Authorization: `Bearer ${key}` } });
    expect(publicRes.status).toBe(403);

    revokeApiKey(db, userId, id);
    expect((await app.request('/api/v1/dashboard', { headers: { Authorization: `Bearer ${key}` } })).status).toBe(401);
  });

  it('通常の読み取りキーでも読める。ポモドーロ予約の口はCookie認証のまま', async () => {
    const { userId } = setup();
    const { key } = issueApiKey(db, userId, 'スクリプト', 'read');
    const app = setupApp(db);

    expect((await app.request('/api/v1/dashboard', { headers: { Authorization: `Bearer ${key}` } })).status).toBe(200);
    const scheduleRes = await app.request('/api/v1/pomodoro/schedule', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_sec: 60 }),
    });
    expect(scheduleRes.status).toBe(401);
  });

  it('レート制限はAPIキーごとに数える', async () => {
    const { userId } = setup();
    const { key: keyA } = issueApiKey(db, userId, 'iPad', 'dashboard');
    const { key: keyB } = issueApiKey(db, userId, 'iPad2', 'dashboard');
    const app = setupApp(db, { RATE_LIMIT_DASHBOARD: '2' });
    const get = (key: string) => app.request('/api/v1/dashboard/today', { headers: { Authorization: `Bearer ${key}` } });

    expect((await get(keyA)).status).toBe(200);
    expect((await get(keyA)).status).toBe(200);
    expect((await get(keyA)).status).toBe(429);
    expect((await get(keyB)).status).toBe(200);
  });

  it('設定画面の発行APIでダッシュボード用キーを作ると、そのキーでダッシュボードを読める', async () => {
    const { userId } = setup();
    const sessionId = 'test-session-' + uuidv7();
    db.prepare('INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)').run(
      sessionId,
      userId,
      Date.now() + DAY,
      Date.now(),
    );
    const app = setupApp(db);

    const createRes = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'iPad', scope: 'dashboard' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { key: string; scope: string };
    expect(created.scope).toBe('dashboard');

    const res = await app.request('/api/v1/dashboard', { headers: { Authorization: `Bearer ${created.key}` } });
    expect(res.status).toBe(200);
  });

  it('日時はJSTのオフセット付きISO 8601にする', () => {
    expect(toJstIso(Date.parse('2026-09-25T15:00:00Z'))).toBe('2026-09-26T00:00:00+09:00');
  });
});
