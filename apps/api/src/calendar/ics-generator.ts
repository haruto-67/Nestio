interface TaskForIcs {
  id: string;
  title: string;
  due_at: number | null;
  due_date: string | null;
  rrule: string | null;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function formatDateOnly(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

/** TZID=Asia/Tokyo で使うローカル時刻表記（UTCではなくJSTの壁時計時刻） */
function formatJstLocal(epochMs: number): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(epochMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`;
}

function formatUtc(epochMs: number): string {
  const iso = new Date(epochMs).toISOString();
  return iso.replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * tasks.rrule には「DTSTART:...\nRRULE:...」の複合文字列が保存されている
 * （apps/web/src/lib/recurrence.ts参照）。ICS側のDTSTARTはタスクの期限フィールドから
 * 生成するため、ここではRRULE:行だけを取り出して使う。
 */
function extractRrulePart(rruleField: string | null): string | null {
  if (!rruleField) return null;
  const line = rruleField.split('\n').find((l) => l.startsWith('RRULE:'));
  return line ? line.slice('RRULE:'.length) : null;
}

function buildVEvent(task: TaskForIcs, nowMs: number): string | null {
  if (task.due_at === null && task.due_date === null) return null;

  const lines: string[] = ['BEGIN:VEVENT'];
  lines.push(`UID:${task.id}@nestio.niwatorimc.com`);
  lines.push(`DTSTAMP:${formatUtc(nowMs)}`);
  lines.push(`SUMMARY:${escapeIcsText(task.title)}`);

  if (task.due_date !== null) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(task.due_date)}`);
  } else if (task.due_at !== null) {
    lines.push(`DTSTART;TZID=Asia/Tokyo:${formatJstLocal(task.due_at)}`);
  }

  const rrule = extractRrulePart(task.rrule);
  if (rrule) lines.push(`RRULE:${rrule}`);

  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

export function generateIcsFeed(tasks: TaskForIcs[], nowMs = Date.now()): string {
  const events = tasks.map((t) => buildVEvent(t, nowMs)).filter((e): e is string => e !== null);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nestio//Nestio Calendar Feed//JA',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
  ];

  return lines.join('\r\n') + '\r\n';
}
