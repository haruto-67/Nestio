import type Database from 'better-sqlite3';
import { uuidv7, type SyncOp } from '@nestio/shared';
import { applySyncOps } from '../../sync/apply.js';
import { expandTemplate } from '../template.js';

/** Hatch起因の書き込みは applySyncOps に triggeredByHatch:true を渡し、再発火（ループ）を防ぐ */
function applyOrThrow(db: Database.Database, userId: string, op: SyncOp): void {
  const result = applySyncOps(db, userId, [op], { triggeredByHatch: true });
  if (result.rejected.length > 0) {
    throw new Error(`action rejected: ${result.rejected[0]?.reason}`);
  }
}

function nextTaskSortOrder(db: Database.Database, listId: string): number {
  const row = db
    .prepare(
      'SELECT MAX(sort_order) as m FROM tasks WHERE list_id = ? AND parent_id IS NULL AND deleted_at IS NULL',
    )
    .get(listId) as { m: number | null };
  return (row.m ?? 0) + 1;
}

function nextNoteSortOrder(db: Database.Database, userId: string): number {
  const row = db.prepare('SELECT MAX(sort_order) as m FROM notes WHERE user_id = ? AND deleted_at IS NULL').get(
    userId,
  ) as { m: number | null };
  return (row.m ?? 0) + 1;
}

export function runAddTag(db: Database.Database, userId: string, subjectTaskId: string, params: { tag_id: string }): void {
  applyOrThrow(db, userId, {
    op_id: uuidv7(),
    table: 'task_tags',
    id: uuidv7(),
    op: 'upsert',
    updated_at: Date.now(),
    fields: { task_id: subjectTaskId, tag_id: params.tag_id },
  });
}

export function runSetPriority(
  db: Database.Database,
  userId: string,
  subjectTaskId: string,
  params: { priority: 0 | 1 | 2 | 3 },
): void {
  applyOrThrow(db, userId, {
    op_id: uuidv7(),
    table: 'tasks',
    id: subjectTaskId,
    op: 'upsert',
    updated_at: Date.now(),
    fields: { priority: params.priority },
  });
}

export function runMoveToList(
  db: Database.Database,
  userId: string,
  subjectTaskId: string,
  params: { list_id: string },
): void {
  applyOrThrow(db, userId, {
    op_id: uuidv7(),
    table: 'tasks',
    id: subjectTaskId,
    op: 'upsert',
    updated_at: Date.now(),
    fields: { list_id: params.list_id },
  });
}

function todayPlusDays(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function runCreateTask(
  db: Database.Database,
  userId: string,
  subjectTaskId: string | null,
  params: { list_id: string; title_template: string; due_offset_days?: number },
): Promise<string> {
  const title = await expandTemplate(db, params.title_template, subjectTaskId, userId);
  const id = uuidv7();
  const fields: Record<string, unknown> = {
    list_id: params.list_id,
    title,
    sort_order: nextTaskSortOrder(db, params.list_id),
  };
  if (params.due_offset_days !== undefined) {
    fields.due_date = todayPlusDays(params.due_offset_days);
  }

  applyOrThrow(db, userId, {
    op_id: uuidv7(),
    table: 'tasks',
    id,
    op: 'upsert',
    updated_at: Date.now(),
    fields,
  });
  return id;
}

export async function runCreateNote(
  db: Database.Database,
  userId: string,
  subjectTaskId: string | null,
  params: { title_template: string; body_template: string },
): Promise<string> {
  const title = await expandTemplate(db, params.title_template, subjectTaskId, userId);
  const body = await expandTemplate(db, params.body_template, subjectTaskId, userId);
  const id = uuidv7();

  applyOrThrow(db, userId, {
    op_id: uuidv7(),
    table: 'notes',
    id,
    op: 'upsert',
    updated_at: Date.now(),
    fields: { title, body, sort_order: nextNoteSortOrder(db, userId) },
  });
  return id;
}
