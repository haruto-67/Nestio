import { describe, expect, it } from 'vitest';
import { generateIcsFeed } from './ics-generator.js';

describe('generateIcsFeed', () => {
  it('VCALENDARの外枠を出力する', () => {
    const ics = generateIcsFeed([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('期限のないタスクはVEVENTを出力しない', () => {
    const ics = generateIcsFeed([{ id: 't1', title: '期限なし', due_at: null, due_date: null, rrule: null }]);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('終日タスクはVALUE=DATEで出力する', () => {
    const ics = generateIcsFeed([
      { id: 't1', title: '終日タスク', due_at: null, due_date: '2026-03-05', rrule: null },
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260305');
    expect(ics).toContain('SUMMARY:終日タスク');
    expect(ics).toContain('UID:t1@nestio.niwatorimc.com');
  });

  it('時刻ありタスクはTZID=Asia/Tokyoで出力する', () => {
    const dueAt = Date.UTC(2026, 2, 5, 1, 0, 0); // UTC 01:00 = JST 10:00
    const ics = generateIcsFeed([{ id: 't2', title: '時刻あり', due_at: dueAt, due_date: null, rrule: null }]);
    expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20260305T100000');
  });

  it('rruleからRRULE:部分のみ抽出する（DTSTART行は出力しない）', () => {
    const ics = generateIcsFeed([
      {
        id: 't3',
        title: '繰り返し',
        due_at: null,
        due_date: '2026-03-05',
        rrule: 'DTSTART:20260305T000000Z\nRRULE:FREQ=WEEKLY;BYDAY=TH',
      },
    ]);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TH');
    expect(ics).not.toMatch(/^DTSTART:20260305T000000Z/m);
  });

  it('タイトル中の特殊文字をエスケープする', () => {
    const ics = generateIcsFeed([
      { id: 't4', title: 'カンマ,セミコロン;バックスラッシュ\\', due_at: null, due_date: '2026-03-05', rrule: null },
    ]);
    expect(ics).toContain('SUMMARY:カンマ\\,セミコロン\\;バックスラッシュ\\\\');
  });

  it('CRLFで行を区切る', () => {
    const ics = generateIcsFeed([]);
    expect(ics).toContain('\r\n');
  });
});
