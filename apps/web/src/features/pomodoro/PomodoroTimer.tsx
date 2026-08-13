import { useTasks } from '../../db/queries.js';
import { schedulePomodoroPush, cancelPomodoroPush } from '../../api/push.js';
import { requestPushPermissionPrompt } from '../../lib/push-prompt.js';
import { usePersistedPomodoroState } from './usePersistedPomodoroState.js';

const PRESETS = [
  { label: '25分', sec: 25 * 60 },
  { label: '5分', sec: 5 * 60 },
];

export function PomodoroTimer({ onClose }: { onClose: () => void }) {
  const tasks = useTasks();
  const {
    durationSec,
    remainingSec,
    running,
    taskId,
    scheduleId,
    setDurationSec,
    setTaskId,
    setScheduleId,
    start: startPersisted,
    stop: stopPersisted,
  } = usePersistedPomodoroState();

  const start = async () => {
    startPersisted();
    requestPushPermissionPrompt('ポモドーロ終了の').catch(() => {});
    try {
      const { id } = await schedulePomodoroPush(durationSec, taskId || undefined);
      setScheduleId(id);
    } catch (err) {
      console.error(err);
    }
  };

  const stop = () => {
    if (scheduleId) {
      cancelPomodoroPush(scheduleId).catch((err) => console.error(err));
    }
    stopPersisted();
  };

  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  const incompleteTasks = tasks.filter((t) => t.completed_at === null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-72 rounded-xl bg-white p-5 text-center shadow-lg dark:bg-neutral-900 nestio-modal-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">ポモドーロ</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        <div className="mb-4 font-mono text-5xl tabular-nums">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>

        {!running && (
          <>
            <div className="mb-3 flex justify-center gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.sec}
                  onClick={() => setDurationSec(p.sec)}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    durationSec === p.sec
                      ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40'
                      : 'border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="mb-3 w-full rounded-md border border-neutral-200 bg-transparent p-1.5 text-xs dark:border-neutral-700"
            >
              <option value="">タスクに紐付けない</option>
              {incompleteTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </>
        )}

        <button
          onClick={() => {
            if (running) stop();
            else start().catch((err) => console.error(err));
          }}
          className="w-full rounded-md bg-neutral-900 py-2 text-sm text-white dark:bg-white dark:text-neutral-900"
        >
          {running ? '中断' : '開始'}
        </button>
      </div>
    </div>
  );
}
