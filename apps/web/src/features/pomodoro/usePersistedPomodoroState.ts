import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'nestio_pomodoro_state';
const EVENT_NAME = 'nestio:pomodoro-changed';

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

/** localStorageへ書き込み、他インスタンスへ変更を通知する */
function persist(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

/**
 * ポモドーロの実行状態(running/終了予定時刻/紐付けタスク/通知予約id)をlocalStorageへ永続化する。
 * モーダルの開閉(PomodoroTimerのマウント/アンマウント)を跨いでも、endAtから残り時間を
 * 再計算することでタイマーが「止まって見える」問題を避ける。
 * このフックはヘッダーのミニ表示（改修13回目）とモーダル本体など複数箇所から同時に
 * 呼ばれうる。useKeymapと同様、各インスタンスは独立したuseStateを持つため、
 * 変更をカスタムイベントで飛ばして全インスタンスへ反映する（改修11回目フォローアップで
 * 判明したキーマップの不具合と同じ原因なので、同じ対処を先取りしておく）。
 * 更新は必ずsetStateの関数形（前回値を引数で受け取る形）で行う：PomodoroTimerのstart()は
 * 直後に非同期処理を挟んでsetScheduleId()を呼ぶため、クロージャに閉じ込めた古いstateから
 * 次の値を組み立てると直前のstart()による更新を上書きしてしまう
 */
export function usePersistedPomodoroState() {
  const [state, setState] = useState<PersistedState>(load);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const handler = () => setState(load());
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

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

  const applyUpdate = (updater: (s: PersistedState) => PersistedState) => {
    setState((s) => {
      const next = updater(s);
      persist(next);
      return next;
    });
  };

  useEffect(() => {
    if (state.running && remainingSec === 0) {
      applyUpdate((s) => ({ ...s, running: false, endAt: null, scheduleId: null }));
    }
  }, [remainingSec, state.running]);

  const setDurationSec = (durationSec: number) => applyUpdate((s) => ({ ...s, durationSec }));
  const setTaskId = (taskId: string) => applyUpdate((s) => ({ ...s, taskId }));
  const start = () => applyUpdate((s) => ({ ...s, running: true, endAt: Date.now() + s.durationSec * 1000 }));
  const setScheduleId = (scheduleId: string | null) => applyUpdate((s) => ({ ...s, scheduleId }));
  const stop = () => applyUpdate((s) => ({ ...s, running: false, endAt: null, scheduleId: null }));

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
