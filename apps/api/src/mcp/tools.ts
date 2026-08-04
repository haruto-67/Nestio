import type Database from 'better-sqlite3';
import { uuidv7, type SyncOp } from '@nestio/shared';
import { applySyncOps } from '../sync/apply.js';
import { searchTasks } from '../search/query.js';

export interface ToolDef {
  name: string;
  scope: 'read' | 'write';
  description: string;
  inputSchema: Record<string, unknown>;
}

/** api-spec.md 10章のツール一覧。書き込み系は/sync/pushと同じ適用ロジック（applySyncOps）を通す */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_tasks',
    scope: 'read',
    description: '未完了タスクの一覧を取得する',
    inputSchema: {
      type: 'object',
      properties: { list_id: { type: 'string' }, limit: { type: 'number' } },
    },
  },
  {
    name: 'search_tasks',
    scope: 'read',
    description: 'タスクをタイトル・本文で全文検索する',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, limit: { type: 'number' } },
      required: ['q'],
    },
  },
  {
    name: 'get_task',
    scope: 'read',
    description: 'タスクIDを指定して詳細を取得する',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_notes',
    scope: 'read',
    description: 'メモの一覧を取得する',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'create_task',
    scope: 'write',
    description: 'タスクを新規作成する',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        title: { type: 'string' },
        note: { type: 'string' },
        priority: { type: 'number' },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        parent_id: { type: 'string', description: '指定するとこのタスクIDのサブタスクとして作成する' },
      },
      required: ['list_id', 'title'],
    },
  },
  {
    name: 'update_task',
    scope: 'write',
    description: 'タスクを更新する',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        note: { type: 'string' },
        priority: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'complete_task',
    scope: 'write',
    description: 'タスクを完了にする（繰り返しタスクの次occurrence計算はしない。単純なcompleted_at設定のみ）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'create_note',
    scope: 'write',
    description: 'メモを新規作成する',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
      required: ['title'],
    },
  },
];

class ToolError extends Error {}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) throw new ToolError(`${key} is required`);
  return v;
}

function nextSortOrderForTasks(db: Database.Database, listId: string, parentId: string | null): number {
  const row = parentId
    ? (db
        .prepare(
          'SELECT MAX(sort_order) as m FROM tasks WHERE list_id = ? AND parent_id = ? AND deleted_at IS NULL',
        )
        .get(listId, parentId) as { m: number | null })
    : (db
        .prepare(
          'SELECT MAX(sort_order) as m FROM tasks WHERE list_id = ? AND parent_id IS NULL AND deleted_at IS NULL',
        )
        .get(listId) as { m: number | null });
  return (row.m ?? 0) + 1;
}

function nextSortOrderForNotes(db: Database.Database, userId: string): number {
  const row = db.prepare('SELECT MAX(sort_order) as m FROM notes WHERE user_id = ? AND deleted_at IS NULL').get(
    userId,
  ) as { m: number | null };
  return (row.m ?? 0) + 1;
}

function applyOneOpOrThrow(db: Database.Database, userId: string, op: SyncOp): void {
  const result = applySyncOps(db, userId, [op]);
  if (result.rejected.length > 0) {
    throw new ToolError(`operation rejected: ${result.rejected[0]?.reason}`);
  }
}

export async function callTool(
  db: Database.Database,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'list_tasks': {
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      const listId = typeof args.list_id === 'string' ? args.list_id : null;
      const rows = listId
        ? db
            .prepare(
              `SELECT id, title, list_id, priority, due_at, due_date, completed_at FROM tasks
               WHERE user_id = ? AND deleted_at IS NULL AND completed_at IS NULL AND list_id = ?
               ORDER BY sort_order LIMIT ?`,
            )
            .all(userId, listId, limit)
        : db
            .prepare(
              `SELECT id, title, list_id, priority, due_at, due_date, completed_at FROM tasks
               WHERE user_id = ? AND deleted_at IS NULL AND completed_at IS NULL
               ORDER BY sort_order LIMIT ?`,
            )
            .all(userId, limit);
      return { tasks: rows };
    }

    case 'search_tasks': {
      const q = requireString(args, 'q');
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      return { tasks: searchTasks(db, userId, q, limit) };
    }

    case 'get_task': {
      const id = requireString(args, 'id');
      const row = db
        .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .get(id, userId);
      if (!row) throw new ToolError('task not found');
      return row;
    }

    case 'list_notes': {
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      const rows = db
        .prepare(
          `SELECT id, title, body, pinned FROM notes
           WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order LIMIT ?`,
        )
        .all(userId, limit);
      return { notes: rows };
    }

    case 'create_task': {
      const listId = requireString(args, 'list_id');
      const title = requireString(args, 'title');
      const parentId = typeof args.parent_id === 'string' ? args.parent_id : null;
      const id = uuidv7();

      const fields: Record<string, unknown> = {
        list_id: listId,
        title,
        sort_order: nextSortOrderForTasks(db, listId, parentId),
      };
      if (parentId) fields.parent_id = parentId;
      if (typeof args.note === 'string') fields.note = args.note;
      if (typeof args.priority === 'number') fields.priority = args.priority;
      if (typeof args.due_date === 'string') fields.due_date = args.due_date;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'tasks',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id, title };
    }

    case 'update_task': {
      const id = requireString(args, 'id');
      const fields: Record<string, unknown> = {};
      if (typeof args.title === 'string') fields.title = args.title;
      if (typeof args.note === 'string') fields.note = args.note;
      if (typeof args.priority === 'number') fields.priority = args.priority;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'tasks',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id };
    }

    case 'complete_task': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'tasks',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields: { completed_at: Date.now() },
      });
      return { id, completed: true };
    }

    case 'create_note': {
      const title = requireString(args, 'title');
      const id = uuidv7();
      const fields: Record<string, unknown> = { title, sort_order: nextSortOrderForNotes(db, userId) };
      if (typeof args.body === 'string') fields.body = args.body;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'notes',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id, title };
    }

    default:
      throw new ToolError(`unknown tool: ${name}`);
  }
}

export function findToolDef(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.name === name);
}
