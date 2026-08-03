import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildRruleString, computeNextOccurrence } from './recurrence.js';

describe('buildRruleString', () => {
  it('DTSTARTとRRULEを含む文字列を生成する（時刻あり）', () => {
    const dueAt = Date.UTC(2026, 0, 6, 9, 0, 0); // 2026-01-06T09:00:00Z (火曜)
    const rrule = buildRruleString('weekly', [1, 3], dueAt, null); // 火・木
    expect(rrule).toContain('DTSTART');
    expect(rrule).toContain('FREQ=WEEKLY');
    expect(rrule).toContain('BYDAY=TU,TH');
  });

  it('終日タスクはUTC日付をDTSTARTにする', () => {
    const rrule = buildRruleString('daily', undefined, null, '2026-01-06');
    expect(rrule).toContain('DTSTART');
    expect(rrule).toContain('FREQ=DAILY');
  });
});

describe('computeNextOccurrence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('時刻ありタスク：予定通りに完了したら次のoccurrenceは1週間後', () => {
    const dueAt = Date.UTC(2026, 0, 6, 9, 0, 0); // 火曜 09:00 UTC
    const rrule = buildRruleString('weekly', [1, 3], dueAt, null); // 火木

    vi.setSystemTime(new Date(dueAt)); // ちょうど予定時刻に完了
    const next = computeNextOccurrence(rrule, false);

    expect(next?.dueAt).toBe(Date.UTC(2026, 0, 8, 9, 0, 0)); // 次は木曜
  });

  it('遅れて完了しても次回期限は元の予定日基準（DTSTARTをズラさない）', () => {
    const dueAt = Date.UTC(2026, 0, 6, 9, 0, 0); // 火曜
    const rrule = buildRruleString('weekly', [1, 3], dueAt, null); // 火木

    // 木曜の分が過ぎた後（金曜）に火曜分を完了させた場合
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 9, 12, 0, 0))); // 金曜
    const next = computeNextOccurrence(rrule, false);

    // 直近1件のみ（火曜・木曜は溜めず、次の火曜に飛ぶ）
    expect(next?.dueAt).toBe(Date.UTC(2026, 0, 13, 9, 0, 0)); // 次の火曜
  });

  it('サボった分は溜めない：何日過ぎていても直近1件だけを返す', () => {
    const dueAt = Date.UTC(2026, 0, 1, 9, 0, 0); // 木曜始まりの毎日タスク
    const rrule = buildRruleString('daily', undefined, dueAt, null);

    vi.setSystemTime(new Date(Date.UTC(2026, 0, 20, 9, 0, 0))); // 19日放置
    const next = computeNextOccurrence(rrule, false);

    expect(next?.dueAt).toBe(Date.UTC(2026, 0, 21, 9, 0, 0)); // 溜まった過去分は生成されない
  });

  it('終日タスクはdue_dateを更新する', () => {
    const rrule = buildRruleString('weekly', [1], null, '2026-01-06'); // 火曜始まり

    vi.setSystemTime(new Date(Date.UTC(2026, 0, 6, 0, 0, 0)));
    const next = computeNextOccurrence(rrule, true);

    expect(next?.dueDate).toBe('2026-01-13');
    expect(next?.dueAt).toBeNull();
  });
});
