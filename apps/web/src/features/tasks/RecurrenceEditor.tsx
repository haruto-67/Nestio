import { useEffect, useState } from 'react';
import type { TaskRow, TaskWritableFields } from '@nestio/shared';
import { Flame } from 'lucide-react';
import { buildRruleString, describeRrule, WEEKDAY_LABELS, type RecurrenceFreq } from '../../lib/recurrence.js';
import { getTaskStreak } from '../../api/streak.js';

type Mode = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';

const MODE_LABELS: Record<Mode, string> = {
  none: 'なし',
  daily: '毎日',
  weekly: '毎週',
  monthly: '毎月',
  custom: 'カスタム',
};

function guessMode(rrule: string | null): Mode {
  if (!rrule) return 'none';
  if (rrule.includes('FREQ=DAILY')) return 'daily';
  if (rrule.includes('FREQ=WEEKLY')) return 'weekly';
  if (rrule.includes('FREQ=MONTHLY')) return 'monthly';
  return 'custom';
}

interface RecurrenceEditorProps {
  task: TaskRow;
  onChange: (fields: TaskWritableFields) => void;
  onSkipOccurrence?: () => void;
}

export function RecurrenceEditor({ task, onChange, onSkipOccurrence }: RecurrenceEditorProps) {
  const [mode, setMode] = useState<Mode>(() => guessMode(task.rrule));
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [customValue, setCustomValue] = useState(task.rrule ?? '');
  const [streak, setStreak] = useState<number | null>(null);

  // 習慣トラッキング（改修5回目）：繰り返しタスクの連続達成数を取得する
  useEffect(() => {
    if (!task.rrule) {
      setStreak(null);
      return;
    }
    let cancelled = false;
    getTaskStreak(task.id)
      .then((s) => {
        if (!cancelled) setStreak(s.streak);
      })
      .catch(() => {
        if (!cancelled) setStreak(null);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, task.rrule, task.due_at, task.due_date]);

  const applyPreset = (nextMode: Mode, nextWeekdays: number[] = weekdays) => {
    setMode(nextMode);
    if (nextMode === 'none') {
      onChange({ rrule: null });
      return;
    }
    if (nextMode === 'custom') return;

    const freq: RecurrenceFreq = nextMode;
    const rrule = buildRruleString(
      freq,
      nextMode === 'weekly' ? nextWeekdays : undefined,
      task.due_at,
      task.due_date,
    );
    onChange({ rrule });
  };

  const toggleWeekday = (i: number) => {
    const next = weekdays.includes(i) ? weekdays.filter((w) => w !== i) : [...weekdays, i].sort((a, b) => a - b);
    setWeekdays(next);
    if (mode === 'weekly') applyPreset('weekly', next);
  };

  const applyCustom = () => {
    const trimmed = customValue.trim();
    if (trimmed) onChange({ rrule: trimmed });
  };

  const hasDue = task.due_at !== null || task.due_date !== null;

  return (
    <div className="flex flex-col gap-1 text-xs text-neutral-500">
      繰り返し
      {!hasDue && mode !== 'none' && <p className="text-amber-500">期限を設定すると繰り返しの起点になります</p>}
      <div className="flex gap-1">
        {(['none', 'daily', 'weekly', 'monthly', 'custom'] as const).map((m) => (
          <button
            key={m}
            onClick={() => applyPreset(m)}
            className={`flex-1 rounded border py-1 text-xs ${
              mode === m ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40' : 'border-neutral-200 dark:border-neutral-700'
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {mode === 'weekly' && (
        <div className="flex gap-1">
          {WEEKDAY_LABELS.map((label, i) => (
            <button
              key={label}
              onClick={() => toggleWeekday(i)}
              className={`flex-1 rounded border py-1 text-xs ${
                weekdays.includes(i)
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40'
                  : 'border-neutral-200 dark:border-neutral-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {mode === 'custom' && (
        <input
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          onBlur={applyCustom}
          placeholder="RRULE:FREQ=WEEKLY;BYDAY=TU,TH"
          className="rounded border border-neutral-200 bg-transparent p-1.5 text-xs dark:border-neutral-700"
        />
      )}

      {task.rrule && <p className="text-neutral-400">{describeRrule(task.rrule)}</p>}
      {task.rrule && streak !== null && streak > 0 && (
        <p className="flex items-center gap-1 text-amber-500">
          <Flame size={12} />
          {streak}回連続達成中
        </p>
      )}
      {task.rrule && onSkipOccurrence && (
        <button
          onClick={onSkipOccurrence}
          title="完了扱いにはせず、次回の予定へ進める"
          className="self-start rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:text-neutral-700 dark:border-neutral-700 dark:hover:text-neutral-200"
        >
          今回だけスキップ
        </button>
      )}
    </div>
  );
}
