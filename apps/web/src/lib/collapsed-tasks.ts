const STORAGE_KEY = 'nestio_collapsed_tasks';
const EVENT_NAME = 'nestio:task-collapsed-changed';

function readAll(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function isTaskCollapsed(taskId: string): boolean {
  return readAll().includes(taskId);
}

/**
 * 折りたたみ状態を変更する。TaskItemは自分のtaskIdについてこのイベントを購読しているので、
 * インデント操作等の外部要因で親を強制展開したい時（setTaskCollapsed(id, false)）にも
 * 該当TaskItemの表示へ即座に反映される
 */
export function setTaskCollapsed(taskId: string, collapsed: boolean): void {
  const all = readAll();
  const next = collapsed ? [...new Set([...all, taskId])] : all.filter((id) => id !== taskId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<{ taskId: string; collapsed: boolean }>(EVENT_NAME, { detail: { taskId, collapsed } }));
}

export function subscribeTaskCollapsed(taskId: string, onChange: (collapsed: boolean) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ taskId: string; collapsed: boolean }>).detail;
    if (detail.taskId === taskId) onChange(detail.collapsed);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
