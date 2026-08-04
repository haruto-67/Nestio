const STORAGE_KEY = 'nestio_collapsed_tasks';

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

export function setTaskCollapsed(taskId: string, collapsed: boolean): void {
  const all = readAll();
  const next = collapsed ? [...new Set([...all, taskId])] : all.filter((id) => id !== taskId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
