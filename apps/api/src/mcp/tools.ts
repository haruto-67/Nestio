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
    description: 'タスクの一覧を取得する（既定では未完了のみ）',
    inputSchema: {
      type: 'object',
      properties: {
        list_id: { type: 'string' },
        parent_id: { type: ['string', 'null'], description: '指定するとそのタスクのサブタスクだけに絞る。nullで最上位階層のみ' },
        include_completed: { type: 'boolean', description: 'trueで完了済みタスクも含める（既定false）' },
        limit: { type: 'number' },
      },
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
        tags: { type: 'array', items: { type: 'string' }, description: 'タグ名の配列。無ければ新規作成する' },
      },
      required: ['list_id', 'title'],
    },
  },
  {
    name: 'update_task',
    scope: 'write',
    description:
      'タスクを更新する。list_idを指定するとリスト移動、parent_idを指定すると親タスクの付け替え' +
      '（循環参照になる場合はエラー）、parent_id: nullを指定すると最上位階層へ戻す',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        note: { type: 'string' },
        priority: { type: 'number' },
        due_date: { type: 'string', description: 'YYYY-MM-DD。空文字で期限をクリアする' },
        list_id: { type: 'string', description: '指定すると別のリストへ移動する' },
        parent_id: { type: ['string', 'null'], description: '親タスクの付け替え。nullで最上位階層に戻す' },
        add_tags: { type: 'array', items: { type: 'string' }, description: '追加するタグ名の配列' },
        remove_tags: { type: 'array', items: { type: 'string' }, description: '外すタグ名の配列' },
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
    name: 'delete_task',
    scope: 'write',
    description: 'タスクを論理削除する（ゴミ箱に入る）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'restore_task',
    scope: 'write',
    description: '論理削除したタスクをゴミ箱から復元する',
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
  {
    name: 'update_note',
    scope: 'write',
    description: 'メモを更新する（タイトル・本文・ピン留め）',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        pinned: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_note',
    scope: 'write',
    description: 'メモを論理削除する（ゴミ箱に入る）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'restore_note',
    scope: 'write',
    description: '論理削除したメモをゴミ箱から復元する',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_lists',
    scope: 'read',
    description: 'リスト（タスクの入れ物）の一覧を取得する。IDが分からないとタスク作成等ができないため必須の起点',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_list',
    scope: 'write',
    description: 'リストを新規作成する',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        folder_id: { type: 'string', description: '所属させるフォルダのID（省略可）' },
        color: { type: 'string', description: '#RRGGBB形式（省略可）' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_list',
    scope: 'write',
    description: 'リストの名前・所属フォルダ・色を変更する',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        folder_id: { type: ['string', 'null'] },
        color: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_list',
    scope: 'write',
    description: 'リストを論理削除する（配下のタスクはリストに残ったまま。UIと同じ挙動）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_folders',
    scope: 'read',
    description: 'フォルダ（リストの入れ物）の一覧を取得する',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_folder',
    scope: 'write',
    description: 'フォルダを新規作成する',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'update_folder',
    scope: 'write',
    description: 'フォルダ名を変更する',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'delete_folder',
    scope: 'write',
    description: 'フォルダを論理削除する',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_tags',
    scope: 'read',
    description: 'タグの一覧を取得する',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_tag',
    scope: 'write',
    description: 'タグを新規作成する（create_task/update_taskのtags引数で同名タグを指定すれば自動作成もされる）',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, color: { type: 'string', description: '#RRGGBB形式（省略可）' } },
      required: ['name'],
    },
  },
  {
    name: 'update_tag',
    scope: 'write',
    description: 'タグの名前・色を変更する',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'delete_tag',
    scope: 'write',
    description: 'タグを論理削除する（付いていたタスクからも外れる）',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'list_triggers',
    scope: 'read',
    description: 'Hatch（自動化トリガー）の一覧を取得する',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_trigger',
    scope: 'write',
    description:
      'Hatchトリガーを新規作成する。event: task_completed/list_all_completed/due_soon/overdue/task_created/schedule、' +
      'action_key: claude_prompt/claude_subtasks/create_task/create_note/add_tag/set_priority/move_to_list/' +
      'push_notify/discord_notify/run_registered_script。condition_json/params_jsonは既存の設定UIで作成した' +
      'トリガーをlist_triggersで見て形式を確認してから組み立てるのが確実',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        event: { type: 'string' },
        condition_json: { type: 'string', description: 'JSON文字列。例: {"list_id":"..."}' },
        action_key: { type: 'string' },
        params_json: { type: 'string', description: 'JSON文字列。例: {"template":"..."}' },
        enabled: { type: 'boolean' },
      },
      required: ['name', 'event', 'action_key'],
    },
  },
  {
    name: 'update_trigger',
    scope: 'write',
    description: 'Hatchトリガーを更新する（有効/無効の切り替えを含む）',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        event: { type: 'string' },
        condition_json: { type: 'string' },
        action_key: { type: 'string' },
        params_json: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_trigger',
    scope: 'write',
    description: 'Hatchトリガーを論理削除する',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
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

function nextSortOrderForLists(db: Database.Database, userId: string): number {
  const row = db.prepare('SELECT MAX(sort_order) as m FROM lists WHERE user_id = ? AND deleted_at IS NULL').get(
    userId,
  ) as { m: number | null };
  return (row.m ?? 0) + 1;
}

function nextSortOrderForFolders(db: Database.Database, userId: string): number {
  const row = db.prepare('SELECT MAX(sort_order) as m FROM folders WHERE user_id = ? AND deleted_at IS NULL').get(
    userId,
  ) as { m: number | null };
  return (row.m ?? 0) + 1;
}

function detachTags(db: Database.Database, userId: string, taskId: string, tagNames: string[]): void {
  for (const name of tagNames) {
    const tag = db
      .prepare('SELECT id FROM tags WHERE user_id = ? AND name = ? AND deleted_at IS NULL')
      .get(userId, name) as { id: string } | undefined;
    if (!tag) continue;
    const row = db
      .prepare('SELECT id FROM task_tags WHERE task_id = ? AND tag_id = ? AND deleted_at IS NULL')
      .get(taskId, tag.id) as { id: string } | undefined;
    if (!row) continue;
    applyOneOpOrThrow(db, userId, {
      op_id: uuidv7(),
      table: 'task_tags',
      id: row.id,
      op: 'delete',
      updated_at: Date.now(),
      fields: {},
    });
  }
}

function findOrCreateTagId(db: Database.Database, userId: string, name: string): string {
  const existing = db
    .prepare('SELECT id FROM tags WHERE user_id = ? AND name = ? AND deleted_at IS NULL')
    .get(userId, name) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = uuidv7();
  applyOneOpOrThrow(db, userId, {
    op_id: uuidv7(),
    table: 'tags',
    id,
    op: 'upsert',
    updated_at: Date.now(),
    fields: { name, color: '#888888' },
  });
  return id;
}

function attachTags(db: Database.Database, userId: string, taskId: string, tagNames: string[]): void {
  for (const name of tagNames) {
    const tagId = findOrCreateTagId(db, userId, name);
    const already = db
      .prepare('SELECT 1 FROM task_tags WHERE task_id = ? AND tag_id = ? AND deleted_at IS NULL')
      .get(taskId, tagId);
    if (already) continue;
    applyOneOpOrThrow(db, userId, {
      op_id: uuidv7(),
      table: 'task_tags',
      id: uuidv7(),
      op: 'upsert',
      updated_at: Date.now(),
      fields: { task_id: taskId, tag_id: tagId },
    });
  }
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
      const parentId = 'parent_id' in args ? (typeof args.parent_id === 'string' ? args.parent_id : null) : undefined;
      const includeCompleted = args.include_completed === true;

      const conditions = ['user_id = ?', 'deleted_at IS NULL'];
      const params: unknown[] = [userId];
      if (!includeCompleted) conditions.push('completed_at IS NULL');
      if (listId) {
        conditions.push('list_id = ?');
        params.push(listId);
      }
      if (parentId !== undefined) {
        if (parentId === null) {
          conditions.push('parent_id IS NULL');
        } else {
          conditions.push('parent_id = ?');
          params.push(parentId);
        }
      }
      params.push(limit);

      const rows = db
        .prepare(
          `SELECT id, title, list_id, parent_id, priority, due_at, due_date, completed_at FROM tasks
           WHERE ${conditions.join(' AND ')} ORDER BY sort_order LIMIT ?`,
        )
        .all(...params);
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

      if (Array.isArray(args.tags)) {
        attachTags(db, userId, id, args.tags.filter((t): t is string => typeof t === 'string'));
      }

      return { id, title };
    }

    case 'update_task': {
      const id = requireString(args, 'id');
      const fields: Record<string, unknown> = {};
      if (typeof args.title === 'string') fields.title = args.title;
      if (typeof args.note === 'string') fields.note = args.note;
      if (typeof args.priority === 'number') fields.priority = args.priority;
      if (typeof args.due_date === 'string') {
        fields.due_date = args.due_date.length > 0 ? args.due_date : null;
        fields.due_at = null;
      }
      if (typeof args.list_id === 'string') fields.list_id = args.list_id;
      if ('parent_id' in args) fields.parent_id = typeof args.parent_id === 'string' ? args.parent_id : null;

      if (Object.keys(fields).length > 0) {
        applyOneOpOrThrow(db, userId, {
          op_id: uuidv7(),
          table: 'tasks',
          id,
          op: 'upsert',
          updated_at: Date.now(),
          fields,
        });
      }

      if (Array.isArray(args.add_tags)) {
        attachTags(db, userId, id, args.add_tags.filter((t): t is string => typeof t === 'string'));
      }
      if (Array.isArray(args.remove_tags)) {
        detachTags(db, userId, id, args.remove_tags.filter((t): t is string => typeof t === 'string'));
      }
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

    case 'delete_task': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'tasks',
        id,
        op: 'delete',
        updated_at: Date.now(),
        fields: {},
      });
      return { id, deleted: true };
    }

    case 'restore_task': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'tasks',
        id,
        op: 'restore',
        updated_at: Date.now(),
        fields: {},
      });
      return { id, restored: true };
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

    case 'update_note': {
      const id = requireString(args, 'id');
      const fields: Record<string, unknown> = {};
      if (typeof args.title === 'string') fields.title = args.title;
      if (typeof args.body === 'string') fields.body = args.body;
      if (typeof args.pinned === 'boolean') fields.pinned = args.pinned ? 1 : 0;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'notes',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id };
    }

    case 'delete_note': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'notes',
        id,
        op: 'delete',
        updated_at: Date.now(),
        fields: {},
      });
      return { id, deleted: true };
    }

    case 'restore_note': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'notes',
        id,
        op: 'restore',
        updated_at: Date.now(),
        fields: {},
      });
      return { id, restored: true };
    }

    case 'list_lists': {
      const rows = db
        .prepare(
          `SELECT id, name, folder_id, color, sort_mode FROM lists
           WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order`,
        )
        .all(userId);
      return { lists: rows };
    }

    case 'create_list': {
      const name = requireString(args, 'name');
      const id = uuidv7();
      const fields: Record<string, unknown> = { name, sort_order: nextSortOrderForLists(db, userId) };
      if (typeof args.folder_id === 'string') fields.folder_id = args.folder_id;
      if (typeof args.color === 'string') fields.color = args.color;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'lists',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id, name };
    }

    case 'update_list': {
      const id = requireString(args, 'id');
      const fields: Record<string, unknown> = {};
      if (typeof args.name === 'string') fields.name = args.name;
      if ('folder_id' in args) fields.folder_id = typeof args.folder_id === 'string' ? args.folder_id : null;
      if (typeof args.color === 'string') fields.color = args.color;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'lists',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id };
    }

    case 'delete_list': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'lists',
        id,
        op: 'delete',
        updated_at: Date.now(),
        fields: {},
      });
      return { id, deleted: true };
    }

    case 'list_folders': {
      const rows = db
        .prepare(`SELECT id, name FROM folders WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order`)
        .all(userId);
      return { folders: rows };
    }

    case 'create_folder': {
      const name = requireString(args, 'name');
      const id = uuidv7();
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'folders',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields: { name, sort_order: nextSortOrderForFolders(db, userId) },
      });
      return { id, name };
    }

    case 'update_folder': {
      const id = requireString(args, 'id');
      const name = requireString(args, 'name');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'folders',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields: { name },
      });
      return { id };
    }

    case 'delete_folder': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'folders',
        id,
        op: 'delete',
        updated_at: Date.now(),
        fields: {},
      });
      return { id, deleted: true };
    }

    case 'list_tags': {
      const rows = db
        .prepare(`SELECT id, name, color FROM tags WHERE user_id = ? AND deleted_at IS NULL ORDER BY name`)
        .all(userId);
      return { tags: rows };
    }

    case 'create_tag': {
      const name = requireString(args, 'name');
      const id = uuidv7();
      const fields: Record<string, unknown> = { name };
      if (typeof args.color === 'string') fields.color = args.color;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'tags',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id, name };
    }

    case 'update_tag': {
      const id = requireString(args, 'id');
      const fields: Record<string, unknown> = {};
      if (typeof args.name === 'string') fields.name = args.name;
      if (typeof args.color === 'string') fields.color = args.color;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'tags',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id };
    }

    case 'delete_tag': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'tags',
        id,
        op: 'delete',
        updated_at: Date.now(),
        fields: {},
      });
      return { id, deleted: true };
    }

    case 'list_triggers': {
      const rows = db
        .prepare(
          `SELECT id, name, event, condition_json, action_key, params_json, enabled FROM triggers
           WHERE user_id = ? AND deleted_at IS NULL ORDER BY name`,
        )
        .all(userId);
      return { triggers: rows };
    }

    case 'create_trigger': {
      const name = requireString(args, 'name');
      const event = requireString(args, 'event');
      const actionKey = requireString(args, 'action_key');
      const id = uuidv7();
      const fields: Record<string, unknown> = { name, event, action_key: actionKey };
      if (typeof args.condition_json === 'string') fields.condition_json = args.condition_json;
      if (typeof args.params_json === 'string') fields.params_json = args.params_json;
      if (typeof args.enabled === 'boolean') fields.enabled = args.enabled ? 1 : 0;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'triggers',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id, name };
    }

    case 'update_trigger': {
      const id = requireString(args, 'id');
      const fields: Record<string, unknown> = {};
      if (typeof args.name === 'string') fields.name = args.name;
      if (typeof args.event === 'string') fields.event = args.event;
      if (typeof args.condition_json === 'string') fields.condition_json = args.condition_json;
      if (typeof args.action_key === 'string') fields.action_key = args.action_key;
      if (typeof args.params_json === 'string') fields.params_json = args.params_json;
      if (typeof args.enabled === 'boolean') fields.enabled = args.enabled ? 1 : 0;

      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'triggers',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });
      return { id };
    }

    case 'delete_trigger': {
      const id = requireString(args, 'id');
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'triggers',
        id,
        op: 'delete',
        updated_at: Date.now(),
        fields: {},
      });
      return { id, deleted: true };
    }

    default:
      throw new ToolError(`unknown tool: ${name}`);
  }
}

export function findToolDef(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.name === name);
}
