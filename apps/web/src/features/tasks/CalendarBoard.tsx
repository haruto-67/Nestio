import { useState, type DragEvent } from 'react';
import type { TaskRow } from '@nestio/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDaysToDateString, todayJstDateString } from '../../lib/datetime.js';
import { taskDueDateStringJst } from '../../lib/task-views.js';

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

function firstOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

function addMonths(dateStr: string, months: number): string {
  const [y, m] = dateStr.split('-').map(Number) as [number, number];
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/** 月の1日を含む週の月曜から6週間分(42日)のグリッドを作る */
function buildMonthGrid(monthStart: string): string[] {
  const [y, m, d] = monthStart.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const gridStart = addDaysToDateString(monthStart, diffToMonday);
  return Array.from({ length: 42 }, (_, i) => addDaysToDateString(gridStart, i));
}

interface CalendarBoardProps {
  tasks: TaskRow[];
  onToggleComplete: (taskId: string, completing: boolean) => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
  onChangeDueDate: (taskId: string, dateStr: string) => void;
}

/** 月表示のカレンダービュー（改修4回目）。日付セルへタスクをドラッグ&ドロップすると
 * その日の終日タスクとして期限を設定する（due_at/due_dateは排他のためdue_atはクリアする） */
export function CalendarBoard({ tasks, onToggleComplete, onSelect, selectedTaskId, onChangeDueDate }: CalendarBoardProps) {
  const today = todayJstDateString();
  const [monthStart, setMonthStart] = useState(() => firstOfMonth(today));
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [showUnscheduled, setShowUnscheduled] = useState(true);

  const tasksByDate = new Map<string, TaskRow[]>();
  const unscheduled: TaskRow[] = [];
  for (const t of tasks) {
    const d = taskDueDateStringJst(t);
    if (d === null) {
      unscheduled.push(t);
      continue;
    }
    const bucket = tasksByDate.get(d);
    if (bucket) bucket.push(t);
    else tasksByDate.set(d, [t]);
  }

  const grid = buildMonthGrid(monthStart);
  const currentMonth = monthStart.slice(0, 7);

  const dragHandlers = (task: TaskRow) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/nestio-task-id', task.id);
      e.dataTransfer.effectAllowed = 'move';
    },
  });

  return (
    <div className="flex h-full flex-col overflow-hidden p-2">
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonthStart((s) => addMonths(s, -1))}
            title="前の月"
            className="flex min-h-8 min-w-8 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setMonthStart(firstOfMonth(today))}
            className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            今月
          </button>
          <button
            onClick={() => setMonthStart((s) => addMonths(s, 1))}
            title="次の月"
            className="flex min-h-8 min-w-8 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <span className="text-sm font-semibold">{currentMonth}</span>
      </div>

      {unscheduled.length > 0 && (
        <div className="mb-2 shrink-0 rounded border border-neutral-200 px-2 py-1 dark:border-neutral-700">
          <button
            onClick={() => setShowUnscheduled((v) => !v)}
            className="text-xs font-semibold text-neutral-400"
          >
            期限なし（{unscheduled.length}件） {showUnscheduled ? '▾' : '▸'}
          </button>
          {showUnscheduled && (
            <div className="mt-1 flex flex-wrap gap-1 pb-1">
              {unscheduled.map((t) => (
                <span
                  key={t.id}
                  {...dragHandlers(t)}
                  onClick={() => onSelect(t.id)}
                  className={`cursor-pointer truncate rounded border border-neutral-200 bg-white px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 ${
                    selectedTaskId === t.id ? 'ring-2 ring-blue-300' : ''
                  } ${t.completed_at !== null ? 'text-neutral-400 line-through' : ''}`}
                >
                  {t.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-7 gap-px overflow-y-auto rounded border border-neutral-200 bg-neutral-200 text-xs dark:border-neutral-700 dark:bg-neutral-800">
        {WEEKDAY_LABELS.map((w) => (
          <div
            key={w}
            className="bg-neutral-50 px-1 py-1 text-center font-semibold text-neutral-400 dark:bg-neutral-900"
          >
            {w}
          </div>
        ))}
        {grid.map((dateStr) => {
          const dayTasks = tasksByDate.get(dateStr) ?? [];
          const inMonth = dateStr.slice(0, 7) === currentMonth;
          const isToday = dateStr === today;
          return (
            <div
              key={dateStr}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/nestio-task-id')) return;
                e.preventDefault();
                setDragOverDate(dateStr);
              }}
              onDragLeave={() => setDragOverDate((d) => (d === dateStr ? null : d))}
              onDrop={(e) => {
                if (!e.dataTransfer.types.includes('text/nestio-task-id')) return;
                e.preventDefault();
                e.stopPropagation();
                setDragOverDate(null);
                const draggedId = e.dataTransfer.getData('text/nestio-task-id');
                if (draggedId) onChangeDueDate(draggedId, dateStr);
              }}
              className={`flex min-h-24 flex-col gap-0.5 p-1 ${
                inMonth ? 'bg-white dark:bg-neutral-900' : 'bg-neutral-50 dark:bg-neutral-950'
              } ${dragOverDate === dateStr ? 'ring-2 ring-inset ring-blue-300' : ''}`}
            >
              <span
                className={`self-end rounded-full px-1.5 text-[11px] ${
                  isToday
                    ? 'bg-amber-400 font-semibold text-white'
                    : inMonth
                      ? 'text-neutral-500 dark:text-neutral-400'
                      : 'text-neutral-300 dark:text-neutral-700'
                }`}
              >
                {Number(dateStr.slice(8, 10))}
              </span>
              {dayTasks.map((t) => (
                <div
                  key={t.id}
                  {...dragHandlers(t)}
                  onClick={() => onSelect(t.id)}
                  className={`flex cursor-pointer items-center gap-1 truncate rounded px-1 py-0.5 ${
                    selectedTaskId === t.id ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={t.completed_at !== null}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onToggleComplete(t.id, e.target.checked)}
                    className="shrink-0"
                  />
                  <span className={`truncate ${t.completed_at !== null ? 'text-neutral-400 line-through' : ''}`}>
                    {t.title}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
