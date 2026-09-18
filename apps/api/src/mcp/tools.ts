import type Database from 'better-sqlite3';
import { uuidv7, markdownToSafeHtml, sha256Schema, knowledgeCategorySchema, type SyncOp } from '@nestio/shared';
import { applySyncOps } from '../sync/apply.js';
import { searchTasks, searchKnowledge } from '../search/query.js';
import { syncKnowledgeLinks, resolveIncomingLinks } from '../knowledge/links.js';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { detectImageMime, verifyImageIntegrity } from '../attachments/magic-bytes.js';
import {
  computeSha256,
  saveAttachmentFile,
  readAttachmentFile,
  attachmentExists,
  getUserAttachmentUsageBytes,
  userOwnsAttachment,
} from '../attachments/storage.js';
import { issueUploadToken } from '../attachments/upload-tokens.js';
import { issueDownloadToken } from '../attachments/download-tokens.js';

type Row = Record<string, unknown>;

export interface ToolDef {
  name: string;
  scope: 'read' | 'write';
  description: string;
  inputSchema: Record<string, unknown>;
}

const MARKDOWN_FIELD_DESC =
  '簡単なMarkdown記法が使える。詳細・画像添付の貼り方はMCPリソース nestio://docs/markdown を参照';

// data_base64経由（LLMが1文字ずつトークン生成する必要がある）はサイズに応じて生成が破損・中断
// しやすいため、上限を小さく絞る（改修17回目）。より大きな画像はcreate_attachment_uploadを使う
const UPLOAD_ATTACHMENT_INLINE_MAX_BYTES = 8 * 1024;
// get_attachmentの結果はJSON-RPCレスポンスにbase64で乗るため、大きすぎるとMCPクライアント側の
// レスポンスサイズ制限に触れうる（改修17回目）。超える場合はbase64を返さずURLのみ返す
const GET_ATTACHMENT_INLINE_MAX_BYTES = 1 * 1024 * 1024;

/** api-spec.md 10章のツール一覧。書き込み系は/sync/pushと同じ適用ロジック（applySyncOps）を通す */
export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_tasks',
    scope: 'read',
    description: 'タスクの一覧を取得する（既定では未完了のみ）。各タスクにtags（{id, name, color}の配列）を含む',
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
    description: 'タスクをタイトル・本文で全文検索する。各タスクにtags（{id, name, color}の配列）を含む',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, limit: { type: 'number' } },
      required: ['q'],
    },
  },
  {
    name: 'get_task',
    scope: 'read',
    description: 'タスクIDを指定して詳細を取得する。tags（{id, name, color}の配列）を含む',
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
        note: { type: 'string', description: MARKDOWN_FIELD_DESC },
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
        note: { type: 'string', description: MARKDOWN_FIELD_DESC },
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
      properties: { title: { type: 'string' }, body: { type: 'string', description: MARKDOWN_FIELD_DESC } },
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
        body: { type: 'string', description: MARKDOWN_FIELD_DESC },
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
    name: 'get_knowledge_index',
    scope: 'read',
    description:
      '全ナレッジの索引（title / description / category / tags / updated_at）を1リクエストで返す。' +
      '本文（body）は含まない。何があるか把握してから、必要なものだけget_knowledgeで本文を取りに行く',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_knowledge',
    scope: 'read',
    description: 'ナレッジの本文を取得する。titles/idsどちらも複数指定可（往復削減のため配列で渡せる）',
    inputSchema: {
      type: 'object',
      properties: {
        titles: { type: 'array', items: { type: 'string' }, description: 'タイトルの配列' },
        ids: { type: 'array', items: { type: 'string' }, description: 'IDの配列' },
      },
    },
  },
  {
    name: 'upsert_knowledge',
    scope: 'write',
    description:
      'titleをキーにナレッジを作成または更新する（同名タイトルが無ければ新規作成）。' +
      '新規作成時はdescription（AIが本文を読むか判断するための1行要約）が必須。' +
      'append: trueでbody末尾に追記する（既存ノートがある場合のみ有効。無ければ通常の新規作成になる）',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        body: { type: 'string', description: MARKDOWN_FIELD_DESC },
        category: { type: 'string', description: "'profile' | 'project' | 'topic' | 'person'" },
        append: { type: 'boolean', description: 'trueならbodyを既存本文の末尾に追記する' },
      },
      required: ['title'],
    },
  },
  {
    name: 'search_knowledge',
    scope: 'read',
    description: 'ナレッジをタイトル・説明・本文で全文検索する。スニペット付きで返す',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, limit: { type: 'number' } },
      required: ['q'],
    },
  },
  {
    name: 'get_backlinks',
    scope: 'read',
    description: '指定ナレッジ（[[タイトル]]でリンクされている側）へのリンク元一覧を返す。idまたはtitleで指定する',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, title: { type: 'string' } },
    },
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
  {
    name: 'upload_attachment',
    scope: 'write',
    description:
      `画像をタスク/メモへの添付として保存し、そのURLを返す。data_base64は${UPLOAD_ATTACHMENT_INLINE_MAX_BYTES}` +
      'バイト程度までを目安にすること。詳しい使い分け・エラー対応表はMCPリソース nestio://docs/attachments を参照',
    inputSchema: {
      type: 'object',
      properties: {
        owner_type: { type: 'string', description: "'task' または 'note'" },
        owner_id: { type: 'string', description: '添付先のタスクIDまたはメモID' },
        filename: { type: 'string' },
        data_base64: { type: 'string', description: '画像データのbase64エンコード（data:...;base64,のprefixは付けない）' },
        sha256: {
          type: 'string',
          description: '（省略可）アップロード元データのSHA-256（16進数64桁・小文字）。渡すと実際のデータと照合し、不一致なら拒否する',
        },
      },
      required: ['owner_type', 'owner_id', 'filename', 'data_base64'],
    },
  },
  {
    name: 'get_attachment',
    scope: 'read',
    description:
      'get_task/list_notesが返すattachments[].urlに対応する画像本体を取得する。' +
      `${GET_ATTACHMENT_INLINE_MAX_BYTES}バイトを超える画像はbase64を返さずtoo_large:trueとurlのみ返す。` +
      '詳しい使い分け・エラー対応表はMCPリソース nestio://docs/attachments を参照',
    inputSchema: {
      type: 'object',
      properties: { sha256: { type: 'string', description: 'attachments[].url末尾のsha256（get_task/list_notesで取得）' } },
      required: ['sha256'],
    },
  },
  {
    name: 'create_attachment_download',
    scope: 'read',
    description:
      '添付画像を直接HTTPで取得するためのワンタイムトークン付きURLを発行する。get_attachmentが' +
      `too_large:trueを返した（${GET_ATTACHMENT_INLINE_MAX_BYTES}バイト超）場合に使う。` +
      '使い方はMCPリソース nestio://docs/attachments を参照',
    inputSchema: {
      type: 'object',
      properties: { sha256: { type: 'string', description: 'attachments[].url末尾のsha256（get_task/list_notesで取得）' } },
      required: ['sha256'],
    },
  },
  {
    name: 'create_attachment_upload',
    scope: 'write',
    description:
      '画像を直接HTTPでアップロードするためのワンタイムトークン付きURLを発行する。コード実行環境から' +
      'Nestioへ直接HTTP通信できる場合はupload_attachmentよりこちらを優先すること。' +
      '呼び出し前にアップロードするファイルのSHA-256（16進数64桁・小文字）を計算しておくこと。' +
      '使い方（POST手順・note/bodyへの貼り方）・エラー対応表はMCPリソース nestio://docs/attachments を参照',
    inputSchema: {
      type: 'object',
      properties: {
        owner_type: { type: 'string', description: "'task' または 'note'" },
        owner_id: { type: 'string', description: '添付先のタスクIDまたはメモID' },
        filename: { type: 'string' },
        sha256: { type: 'string', description: 'アップロードするファイルのSHA-256（16進数64桁・小文字）' },
      },
      required: ['owner_type', 'owner_id', 'filename', 'sha256'],
    },
  },
];

// 改修22回目：公開API（routes/public-api.ts）がinstanceofで判定し404/400を出し分けるためexportする
export class ToolError extends Error {}

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
    // task_tags(task_id, tag_id)には論理削除を無視した一意制約があるため、以前付けて外した
    // タグを再度付ける時は新規行をINSERTせず、既存の（論理削除済み）行をrestoreする必要がある
    // （改修21回目：新規INSERTしてUNIQUE constraint failedになる不具合を修正）
    const existing = db
      .prepare('SELECT id, deleted_at FROM task_tags WHERE task_id = ? AND tag_id = ?')
      .get(taskId, tagId) as { id: string; deleted_at: number | null } | undefined;
    if (existing && existing.deleted_at === null) continue;
    if (existing) {
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'task_tags',
        id: existing.id,
        op: 'restore',
        updated_at: Date.now(),
        fields: {},
      });
      continue;
    }
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

interface AttachmentSummary {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  url: string;
}

interface TagSummary {
  id: string;
  name: string;
  color: string;
}

/**
 * タスクに紐づくタグの一覧（改修21回目：get_task/list_tasks/search_tasksがタグを返さず、
 * Claudeが会話中にタスクへ付いているタグを把握できなかったため追加）
 */
function listTaskTags(db: Database.Database, userId: string, taskId: string): TagSummary[] {
  return db
    .prepare(
      `SELECT tags.id as id, tags.name as name, tags.color as color
       FROM task_tags
       JOIN tags ON tags.id = task_tags.tag_id
       WHERE task_tags.task_id = ? AND task_tags.user_id = ?
         AND task_tags.deleted_at IS NULL AND tags.deleted_at IS NULL
       ORDER BY tags.name`,
    )
    .all(taskId, userId) as TagSummary[];
}

/**
 * listTaskTagsのバッチ版（改修24回目：list_tasks/search_tasksがタスク件数分クエリを発行していた
 * N+1を解消するため追加）。taskIdごとのタグ配列を1回のIN検索でまとめて取る
 */
function listTaskTagsBatch(
  db: Database.Database,
  userId: string,
  taskIds: string[],
): Map<string, TagSummary[]> {
  const result = new Map<string, TagSummary[]>();
  if (taskIds.length === 0) return result;

  const placeholders = taskIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT task_tags.task_id as task_id, tags.id as id, tags.name as name, tags.color as color
       FROM task_tags
       JOIN tags ON tags.id = task_tags.tag_id
       WHERE task_tags.task_id IN (${placeholders}) AND task_tags.user_id = ?
         AND task_tags.deleted_at IS NULL AND tags.deleted_at IS NULL
       ORDER BY tags.name`,
    )
    .all(...taskIds, userId) as (TagSummary & { task_id: string })[];

  for (const { task_id, ...tag } of rows) {
    const list = result.get(task_id);
    if (list) list.push(tag);
    else result.set(task_id, [tag]);
  }
  return result;
}

/**
 * listTaskTagsBatchのナレッジ版（改修24回目）。knowledge_idごとのタグ配列を1回のIN検索で取る
 */
function listKnowledgeTagsBatch(
  db: Database.Database,
  userId: string,
  knowledgeIds: string[],
): Map<string, TagSummary[]> {
  const result = new Map<string, TagSummary[]>();
  if (knowledgeIds.length === 0) return result;

  const placeholders = knowledgeIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT knowledge_tags.knowledge_id as knowledge_id, tags.id as id, tags.name as name, tags.color as color
       FROM knowledge_tags
       JOIN tags ON tags.id = knowledge_tags.tag_id
       WHERE knowledge_tags.knowledge_id IN (${placeholders}) AND knowledge_tags.user_id = ?
         AND knowledge_tags.deleted_at IS NULL AND tags.deleted_at IS NULL
       ORDER BY tags.name`,
    )
    .all(...knowledgeIds, userId) as (TagSummary & { knowledge_id: string })[];

  for (const { knowledge_id, ...tag } of rows) {
    const list = result.get(knowledge_id);
    if (list) list.push(tag);
    else result.set(knowledge_id, [tag]);
  }
  return result;
}

/**
 * タスク/メモに紐づく添付の一覧（改修16回目：MCP経由で添付画像を確認できるようにする要望への
 * 対応）。UI内部で使うサムネイル（`__thumb__`prefix、apps/web側で生成）は実装の詳細なので除く
 */
function listAttachments(
  db: Database.Database,
  userId: string,
  ownerType: 'task' | 'note',
  ownerId: string,
): AttachmentSummary[] {
  const rows = db
    .prepare(
      `SELECT id, filename, mime, bytes, width, height, sha256 FROM attachments
       WHERE user_id = ? AND owner_type = ? AND owner_id = ? AND deleted_at IS NULL
       AND filename NOT LIKE '\\_\\_thumb\\_\\_%' ESCAPE '\\'
       ORDER BY created_at`,
    )
    .all(userId, ownerType, ownerId) as {
    id: string;
    filename: string;
    mime: string;
    bytes: number;
    width: number | null;
    height: number | null;
    sha256: string;
  }[];
  return rows.map(({ sha256, ...rest }) => ({ ...rest, url: `/api/v1/attachments/${sha256}` }));
}

/**
 * listAttachmentsのバッチ版（改修24回目：list_notesがメモ件数分クエリを発行していたN+1を
 * 解消するため追加）。ownerIdごとの添付配列を1回のIN検索でまとめて取る
 */
function listAttachmentsBatch(
  db: Database.Database,
  userId: string,
  ownerType: 'task' | 'note',
  ownerIds: string[],
): Map<string, AttachmentSummary[]> {
  const result = new Map<string, AttachmentSummary[]>();
  if (ownerIds.length === 0) return result;

  const placeholders = ownerIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT owner_id, id, filename, mime, bytes, width, height, sha256 FROM attachments
       WHERE user_id = ? AND owner_type = ? AND owner_id IN (${placeholders}) AND deleted_at IS NULL
       AND filename NOT LIKE '\\_\\_thumb\\_\\_%' ESCAPE '\\'
       ORDER BY created_at`,
    )
    .all(userId, ownerType, ...ownerIds) as {
    owner_id: string;
    id: string;
    filename: string;
    mime: string;
    bytes: number;
    width: number | null;
    height: number | null;
    sha256: string;
  }[];

  for (const { owner_id, sha256, ...rest } of rows) {
    const summary = { ...rest, url: `/api/v1/attachments/${sha256}` };
    const list = result.get(owner_id);
    if (list) list.push(summary);
    else result.set(owner_id, [summary]);
  }
  return result;
}

function applyOneOpOrThrow(db: Database.Database, userId: string, op: SyncOp): void {
  const result = applySyncOps(db, userId, [op]);
  if (result.rejected.length > 0) {
    throw new ToolError(`operation rejected: ${result.rejected[0]?.reason}`);
  }
}

export async function callTool(
  db: Database.Database,
  env: Env,
  logger: Logger,
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
        .all(...params) as { id: string }[];
      const tagsByTaskId = listTaskTagsBatch(db, userId, rows.map((t) => t.id));
      return { tasks: rows.map((t) => ({ ...t, tags: tagsByTaskId.get(t.id) ?? [] })) };
    }

    case 'search_tasks': {
      const q = requireString(args, 'q');
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      const results = searchTasks(db, userId, q, limit);
      const tagsByTaskId = listTaskTagsBatch(db, userId, results.map((t) => t.id));
      return { tasks: results.map((t) => ({ ...t, tags: tagsByTaskId.get(t.id) ?? [] })) };
    }

    case 'get_task': {
      const id = requireString(args, 'id');
      const row = db
        .prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
        .get(id, userId) as Record<string, unknown> | undefined;
      if (!row) throw new ToolError('task not found');
      return { ...row, tags: listTaskTags(db, userId, id), attachments: listAttachments(db, userId, 'task', id) };
    }

    case 'list_notes': {
      const limit = typeof args.limit === 'number' ? args.limit : 50;
      const rows = db
        .prepare(
          `SELECT id, title, body, pinned FROM notes
           WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order LIMIT ?`,
        )
        .all(userId, limit) as { id: string; title: string; body: string; pinned: number }[];
      const attachmentsByNoteId = listAttachmentsBatch(db, userId, 'note', rows.map((n) => n.id));
      return { notes: rows.map((n) => ({ ...n, attachments: attachmentsByNoteId.get(n.id) ?? [] })) };
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
      if (typeof args.note === 'string') fields.note = markdownToSafeHtml(args.note);
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
      if (typeof args.note === 'string') fields.note = markdownToSafeHtml(args.note);
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
      if (typeof args.body === 'string') fields.body = markdownToSafeHtml(args.body);

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
      if (typeof args.body === 'string') fields.body = markdownToSafeHtml(args.body);
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

    case 'get_knowledge_index': {
      const rows = db
        .prepare(
          `SELECT id, title, description, category, updated_at FROM knowledge
           WHERE user_id = ? AND deleted_at IS NULL ORDER BY title`,
        )
        .all(userId) as { id: string }[];
      const tagsByKnowledgeId = listKnowledgeTagsBatch(db, userId, rows.map((k) => k.id));
      return { knowledge: rows.map((k) => ({ ...k, tags: tagsByKnowledgeId.get(k.id) ?? [] })) };
    }

    case 'get_knowledge': {
      const titles = Array.isArray(args.titles) ? args.titles.filter((t): t is string => typeof t === 'string') : [];
      const ids = Array.isArray(args.ids) ? args.ids.filter((t): t is string => typeof t === 'string') : [];
      if (titles.length === 0 && ids.length === 0) {
        throw new ToolError('titlesまたはidsのいずれかを指定してください');
      }

      const rows: Row[] = [];
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ');
        rows.push(
          ...(db
            .prepare(
              `SELECT * FROM knowledge WHERE user_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
            )
            .all(userId, ...ids) as Row[]),
        );
      }
      if (titles.length > 0) {
        const placeholders = titles.map(() => '?').join(', ');
        rows.push(
          ...(db
            .prepare(
              `SELECT * FROM knowledge WHERE user_id = ? AND title IN (${placeholders}) AND deleted_at IS NULL`,
            )
            .all(userId, ...titles) as Row[]),
        );
      }

      const seen = new Set<string>();
      const unique = rows.filter((r) => {
        const id = r.id as string;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const tagsByKnowledgeId = listKnowledgeTagsBatch(db, userId, unique.map((r) => r.id as string));
      return { knowledge: unique.map((r) => ({ ...r, tags: tagsByKnowledgeId.get(r.id as string) ?? [] })) };
    }

    case 'upsert_knowledge': {
      const title = requireString(args, 'title');
      const existing = db
        .prepare('SELECT * FROM knowledge WHERE user_id = ? AND title = ? AND deleted_at IS NULL')
        .get(userId, title) as Row | undefined;

      if (!existing && (typeof args.description !== 'string' || args.description.length === 0)) {
        throw new ToolError('新規作成時はdescription（1行要約）が必須です');
      }

      const fields: Record<string, unknown> = {};
      if (!existing) fields.title = title;
      if (typeof args.description === 'string') fields.description = args.description;
      if (typeof args.category === 'string') {
        if (!knowledgeCategorySchema.safeParse(args.category).success) {
          throw new ToolError("categoryは'profile' | 'project' | 'topic' | 'person'のいずれかである必要があります");
        }
        fields.category = args.category;
      }
      if (typeof args.body === 'string') {
        const html = markdownToSafeHtml(args.body);
        fields.body = args.append === true && existing ? `${existing.body as string}${html}` : html;
      }

      const id = existing ? (existing.id as string) : uuidv7();
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'knowledge',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields,
      });

      // bodyが変わった時だけ再パースする（改修24回目フォローアップ：[[リンク]]のパースとバックリンク）
      if (typeof fields.body === 'string') {
        syncKnowledgeLinks(db, userId, id, fields.body);
      }
      // 新規作成時は、このタイトルを指していた未解決リンクを解決する
      if (!existing) {
        resolveIncomingLinks(db, userId, title, id);
      }

      return { id, title, created: !existing };
    }

    case 'search_knowledge': {
      const q = requireString(args, 'q');
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      return { knowledge: searchKnowledge(db, userId, q, limit) };
    }

    case 'get_backlinks': {
      const idArg = typeof args.id === 'string' ? args.id : undefined;
      const titleArg = typeof args.title === 'string' ? args.title : undefined;
      if (!idArg && !titleArg) throw new ToolError('idまたはtitleを指定してください');

      let targetId: string | null = idArg ?? null;
      let targetTitle: string | null = titleArg ?? null;
      if (targetId) {
        const row = db
          .prepare('SELECT title FROM knowledge WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
          .get(targetId, userId) as { title: string } | undefined;
        if (!row) throw new ToolError('ナレッジが見つかりません');
        targetTitle = row.title;
      } else {
        const row = db
          .prepare('SELECT id FROM knowledge WHERE user_id = ? AND title = ? AND deleted_at IS NULL')
          .get(userId, targetTitle) as { id: string } | undefined;
        targetId = row?.id ?? null;
      }

      const rows = db
        .prepare(
          `SELECT knowledge.id as id, knowledge.title as title
           FROM knowledge_links
           JOIN knowledge ON knowledge.id = knowledge_links.from_id
           WHERE knowledge_links.user_id = ? AND knowledge_links.deleted_at IS NULL AND knowledge.deleted_at IS NULL
             AND (knowledge_links.to_id = ? OR (knowledge_links.to_id IS NULL AND knowledge_links.to_title = ?))
           ORDER BY knowledge.title`,
        )
        .all(userId, targetId, targetTitle);
      return { backlinks: rows };
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

    case 'upload_attachment': {
      const ownerType = requireString(args, 'owner_type');
      if (ownerType !== 'task' && ownerType !== 'note') {
        throw new ToolError("owner_typeは'task'または'note'である必要があります");
      }
      const ownerId = requireString(args, 'owner_id');
      const filename = requireString(args, 'filename');
      const dataBase64 = requireString(args, 'data_base64');
      const expectedSha256 = typeof args.sha256 === 'string' ? args.sha256 : undefined;
      if (expectedSha256 !== undefined && !sha256Schema.safeParse(expectedSha256).success) {
        throw new ToolError('sha256は16進数64桁（小文字）である必要があります');
      }

      const buf = Buffer.from(dataBase64, 'base64');
      if (buf.length === 0) throw new ToolError('画像データが空です');
      if (buf.length > UPLOAD_ATTACHMENT_INLINE_MAX_BYTES) {
        throw new ToolError(
          `data_base64でアップロードできるのは${UPLOAD_ATTACHMENT_INLINE_MAX_BYTES}バイトまでです。` +
            'より大きな画像はcreate_attachment_uploadツールを使ってください',
        );
      }
      const usage = getUserAttachmentUsageBytes(db, userId);
      if (usage + buf.length > env.ATTACHMENT_QUOTA_BYTES) {
        throw new ToolError('ユーザーの総容量上限を超えています');
      }

      const mime = detectImageMime(buf);
      if (!mime) {
        logger.warn({ ownerType, ownerId, bytes: buf.length }, 'mcp_upload_attachment_invalid_mime');
        throw new ToolError('画像形式として認識できませんでした（PNG/JPEG/WebP/GIFのみ対応）');
      }

      const sha256 = computeSha256(buf);
      if (expectedSha256 !== undefined && expectedSha256 !== sha256) {
        logger.warn(
          { ownerType, ownerId, expectedSha256, actualSha256: sha256, bytes: buf.length },
          'mcp_upload_attachment_sha256_mismatch',
        );
        throw new ToolError(
          `指定されたsha256（${expectedSha256}）と実際のデータのsha256（${sha256}）が一致しません。` +
            'base64の生成中に文字化けした可能性があるため、もう一度生成してアップロードし直してください',
        );
      }
      if (!verifyImageIntegrity(buf, mime)) {
        logger.warn({ ownerType, ownerId, sha256, mime, bytes: buf.length }, 'mcp_upload_attachment_integrity_failed');
        throw new ToolError(
          '画像データが壊れています（整合性チェック不一致）。base64の生成中に文字化けした可能性があるため、もう一度生成してアップロードし直してください',
        );
      }

      saveAttachmentFile(env.ATTACHMENT_DIR, sha256, buf, env.ATTACHMENT_ENCRYPTION_KEY || undefined);

      const id = uuidv7();
      applyOneOpOrThrow(db, userId, {
        op_id: uuidv7(),
        table: 'attachments',
        id,
        op: 'upsert',
        updated_at: Date.now(),
        fields: { owner_type: ownerType, owner_id: ownerId, sha256, filename, mime, bytes: buf.length },
      });

      logger.info({ ownerType, ownerId, sha256, mime, bytes: buf.length }, 'mcp_upload_attachment_success');
      return { id, mime, bytes: buf.length, url: `/api/v1/attachments/${sha256}` };
    }

    case 'get_attachment': {
      const sha256Param = requireString(args, 'sha256');
      if (!userOwnsAttachment(db, userId, sha256Param) || !attachmentExists(env.ATTACHMENT_DIR, sha256Param)) {
        logger.warn({ sha256: sha256Param }, 'mcp_get_attachment_not_found');
        throw new ToolError('添付ファイルが見つかりません');
      }
      const row = db
        .prepare('SELECT mime, bytes FROM attachments WHERE user_id = ? AND sha256 = ? AND deleted_at IS NULL LIMIT 1')
        .get(userId, sha256Param) as { mime: string; bytes: number } | undefined;

      if (row && row.bytes > GET_ATTACHMENT_INLINE_MAX_BYTES) {
        logger.info({ sha256: sha256Param, bytes: row.bytes }, 'mcp_get_attachment_too_large_for_inline');
        return {
          too_large: true,
          bytes: row.bytes,
          mime: row.mime,
          url: `/api/v1/attachments/${sha256Param}`,
          message: 'コード実行環境が使えるなら、create_attachment_downloadで直接取得できます',
        };
      }

      const buf = readAttachmentFile(env.ATTACHMENT_DIR, sha256Param, env.ATTACHMENT_ENCRYPTION_KEY || undefined);
      logger.info({ sha256: sha256Param, bytes: buf.length }, 'mcp_get_attachment_success');
      return { __image: true as const, mime: row?.mime ?? 'application/octet-stream', data_base64: buf.toString('base64') };
    }

    case 'create_attachment_upload': {
      const ownerType = requireString(args, 'owner_type');
      if (ownerType !== 'task' && ownerType !== 'note') {
        throw new ToolError("owner_typeは'task'または'note'である必要があります");
      }
      const ownerId = requireString(args, 'owner_id');
      const filename = requireString(args, 'filename');
      const sha256 = requireString(args, 'sha256');
      if (!sha256Schema.safeParse(sha256).success) {
        throw new ToolError('sha256は16進数64桁（小文字）である必要があります');
      }

      const { token, expiresAt } = issueUploadToken(db, userId, ownerType, ownerId, filename, sha256);
      logger.info({ ownerType, ownerId, sha256, filename }, 'mcp_create_attachment_upload');

      return {
        upload_url: `${env.APP_ORIGIN}/api/v1/attachments/${sha256}`,
        upload_token: token,
        expires_at: expiresAt,
      };
    }

    case 'create_attachment_download': {
      const sha256Param = requireString(args, 'sha256');
      if (!userOwnsAttachment(db, userId, sha256Param) || !attachmentExists(env.ATTACHMENT_DIR, sha256Param)) {
        logger.warn({ sha256: sha256Param }, 'mcp_create_attachment_download_not_found');
        throw new ToolError('添付ファイルが見つかりません');
      }

      const { token, expiresAt } = issueDownloadToken(db, userId, sha256Param);
      logger.info({ sha256: sha256Param }, 'mcp_create_attachment_download');

      return {
        download_url: `${env.APP_ORIGIN}/api/v1/attachments/${sha256Param}`,
        download_token: token,
        expires_at: expiresAt,
      };
    }

    default:
      throw new ToolError(`unknown tool: ${name}`);
  }
}

export function findToolDef(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.name === name);
}
