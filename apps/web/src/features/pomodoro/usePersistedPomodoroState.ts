import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'nestio_pomodoro_state';

interface PersistedState {
  durationSec: number;
  taskId: string;
  running: boolean;
  endAt: number | null;
  scheduleId: string | null;
}

const DEFAULT_STATE: PersistedState = {
  durationSec: 25 * 60,
  taskId: '',
  running: false,
  endAt: null,
  scheduleId: null,
};

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<PersistedState>) };
  } catch {
    return DEFAULT_STATE;
  }
}

function save(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * ポモドーロの実行状態(running/終了予定時刻/紐付けタスク/通知予約id)をlocalStorageへ永続化する。
 * モーダルの開閉(PomodoroTimerのマウント/アンマウント)を跨いでも、endAtから残り時間を
 * 再計算することでタイマーが「止まって見える」問題を避ける。
 */
export function usePersistedPomodoroState() {
  const [state, setState] = useState<PersistedState>(load);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    save(state);
  }, [state]);

  useEffect(() => {
    if (!state.running) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    tickRef.current = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [state.running]);

  const remainingSec = (() => {
    if (!state.running || state.endAt === null) return state.durationSec;
    return Math.max(0, Math.ceil((state.endAt - Date.now()) / 1000));
  })();

  useEffect(() => {
    if (state.running && remainingSec === 0) {
      setState((s) => ({ ...s, running: false, endAt: null, scheduleId: null }));
    }
  }, [remainingSec, state.running]);

  const setDurationSec = (durationSec: number) => setState((s) => ({ ...s, durationSec }));
  const setTaskId = (taskId: string) => setState((s) => ({ ...s, taskId }));

  const start = () => {
    setState((s) => ({ ...s, running: true, endAt: Date.now() + s.durationSec * 1000 }));
  };

  const setScheduleId = (scheduleId: string | null) => setState((s) => ({ ...s, scheduleId }));

  const stop = () => {
    setState((s) => ({ ...s, running: false, endAt: null, scheduleId: null }));
  };

  return {
    durationSec: state.durationSec,
    taskId: state.taskId,
    running: state.running,
    remainingSec,
    scheduleId: state.scheduleId,
    setDurationSec,
    setTaskId,
    setScheduleId,
    start,
    stop,
  };
}
