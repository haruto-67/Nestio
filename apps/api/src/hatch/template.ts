import type Database from 'better-sqlite3';

interface TaskForTemplate {
  title: string;
  note: string;
  due_at: number | null;
  due_date: string | null;
  list_id: string;
}

/** {{task.title}} {{task.note}} {{list.name}} {{task.due}} のみ展開する。任意の式評価は実装しない（api-spec.md） */
export function expandTemplate(db: Database.Database, template: string, taskId: string | null): string {
  if (!taskId) return template.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');

  const task = db
    .prepare('SELECT title, note, due_at, due_date, list_id FROM tasks WHERE id = ?')
    .get(taskId) as TaskForTemplate | undefined;
  if (!task) return template.replace(/\{\{\s*[\w.]+\s*\}\}/g, '');

  const list = db.prepare('SELECT name FROM lists WHERE id = ?').get(task.list_id) as { name: string } | undefined;
  const due = task.due_date ?? (task.due_at !== null ? new Date(task.due_at).toISOString() : '');

  const values: Record<string, string> = {
    'task.title': task.title,
    'task.note': task.note,
    'list.name': list?.name ?? '',
    'task.due': due,
  };

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => values[key] ?? '');
}
