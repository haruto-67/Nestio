import { Hono, type Context } from 'hono';
import type { AppVariables } from '../middleware/request-context.js';
import { requireApiKey } from '../middleware/api-key-auth.js';
import { hasApiKeyScope } from '../api-keys/keys.js';
import { callTool, findToolDef, ToolError } from '../mcp/tools.js';
import { ApiError } from '../errors.js';

/**
 * 「API化」機能（改修22回目）：外部スクリプト・Zapier等のサービス連携から、個人用APIキーで
 * 手軽に叩けるRESTエンドポイント群。docs/api-spec.md 2章は「CRUD用の個別エンドポイントは
 * 作らない」としているが、これは"同期ロジックの二重実装"を禁じる趣旨（別実装だとseq採番や
 * 循環チェックを漏らしうるため）。ここでは新しいロジックを一切持たず、MCPツール
 * （apps/api/src/mcp/tools.ts の callTool）をそのまま呼ぶ薄いアダプタに徹することで、
 * MCP自身が既にそうしているのと同じやり方で原則の趣旨を満たす
 */
export const publicApiRoute = new Hono<{ Variables: AppVariables }>();

publicApiRoute.use('/public/*', requireApiKey);

type ArgsBuilder = (c: Context<{ Variables: AppVariables }>) => Record<string, unknown> | Promise<Record<string, unknown>>;

function toolRoute(toolName: string, buildArgs: ArgsBuilder) {
  return async (c: Context<{ Variables: AppVariables }>) => {
    const toolDef = findToolDef(toolName);
    if (!toolDef) throw new ApiError('internal', `unknown tool: ${toolName}`);

    const scope = c.get('apiKeyScope') ?? '';
    if (!hasApiKeyScope(scope, toolDef.scope)) {
      throw new ApiError('forbidden', 'このAPIキーにはこの操作の権限がありません（読み書きキーが必要です）');
    }

    const userId = c.get('userId');
    if (!userId) throw new ApiError('unauthenticated', 'APIキーが必要です');

    const args = await buildArgs(c);
    try {
      const result = await callTool(c.get('db'), c.get('env'), c.get('logger'), userId, toolName, args);
      return c.json(result);
    } catch (err) {
      if (err instanceof ToolError) throw new ApiError('validation_failed', err.message);
      throw err;
    }
  };
}

function numberQuery(c: Context, name: string): number | undefined {
  const v = c.req.query(name);
  return v === undefined ? undefined : Number(v);
}

// ---- タスク ----
publicApiRoute.get(
  '/public/tasks',
  toolRoute('list_tasks', (c) => {
    // list_tasksのparent_idは「キーが存在するかどうか」で意味が変わる（tools.tsのcallTool参照）：
    // 無指定=絞り込みなし、null=最上位のみ、文字列=そのタスクの子のみ。クエリパラメータでも
    // 同じ3値を区別できるよう、指定があった時だけキーを含める
    const args: Record<string, unknown> = {
      list_id: c.req.query('list_id'),
      include_completed: c.req.query('include_completed') === 'true',
      limit: numberQuery(c, 'limit'),
    };
    const parentIdParam = c.req.query('parent_id');
    if (parentIdParam !== undefined) {
      args.parent_id = parentIdParam === '' || parentIdParam === 'null' ? null : parentIdParam;
    }
    return args;
  }),
);
// 固定パス/public/tasks/searchは/public/tasks/:idより先に登録し、"search"がidパラメータとして
// マッチしないようにする
publicApiRoute.get(
  '/public/tasks/search',
  toolRoute('search_tasks', (c) => ({ q: c.req.query('q'), limit: numberQuery(c, 'limit') })),
);
publicApiRoute.get('/public/tasks/:id', toolRoute('get_task', (c) => ({ id: c.req.param('id') })));
publicApiRoute.post('/public/tasks', toolRoute('create_task', async (c) => await c.req.json()));
publicApiRoute.patch(
  '/public/tasks/:id',
  toolRoute('update_task', async (c) => ({ id: c.req.param('id'), ...(await c.req.json()) })),
);
publicApiRoute.post(
  '/public/tasks/:id/complete',
  toolRoute('complete_task', (c) => ({ id: c.req.param('id') })),
);
publicApiRoute.delete('/public/tasks/:id', toolRoute('delete_task', (c) => ({ id: c.req.param('id') })));
publicApiRoute.post(
  '/public/tasks/:id/restore',
  toolRoute('restore_task', (c) => ({ id: c.req.param('id') })),
);

// ---- メモ ----
publicApiRoute.get('/public/notes', toolRoute('list_notes', (c) => ({ limit: numberQuery(c, 'limit') })));
publicApiRoute.post('/public/notes', toolRoute('create_note', async (c) => await c.req.json()));
publicApiRoute.patch(
  '/public/notes/:id',
  toolRoute('update_note', async (c) => ({ id: c.req.param('id'), ...(await c.req.json()) })),
);
publicApiRoute.delete('/public/notes/:id', toolRoute('delete_note', (c) => ({ id: c.req.param('id') })));
publicApiRoute.post(
  '/public/notes/:id/restore',
  toolRoute('restore_note', (c) => ({ id: c.req.param('id') })),
);

// ---- リスト ----
publicApiRoute.get('/public/lists', toolRoute('list_lists', () => ({})));
publicApiRoute.post('/public/lists', toolRoute('create_list', async (c) => await c.req.json()));
publicApiRoute.patch(
  '/public/lists/:id',
  toolRoute('update_list', async (c) => ({ id: c.req.param('id'), ...(await c.req.json()) })),
);
publicApiRoute.delete('/public/lists/:id', toolRoute('delete_list', (c) => ({ id: c.req.param('id') })));

// ---- フォルダ ----
publicApiRoute.get('/public/folders', toolRoute('list_folders', () => ({})));
publicApiRoute.post('/public/folders', toolRoute('create_folder', async (c) => await c.req.json()));
publicApiRoute.patch(
  '/public/folders/:id',
  toolRoute('update_folder', async (c) => ({ id: c.req.param('id'), ...(await c.req.json()) })),
);
publicApiRoute.delete('/public/folders/:id', toolRoute('delete_folder', (c) => ({ id: c.req.param('id') })));

// ---- タグ ----
publicApiRoute.get('/public/tags', toolRoute('list_tags', () => ({})));
publicApiRoute.post('/public/tags', toolRoute('create_tag', async (c) => await c.req.json()));
publicApiRoute.patch(
  '/public/tags/:id',
  toolRoute('update_tag', async (c) => ({ id: c.req.param('id'), ...(await c.req.json()) })),
);
publicApiRoute.delete('/public/tags/:id', toolRoute('delete_tag', (c) => ({ id: c.req.param('id') })));

// ---- Hatchトリガー ----
publicApiRoute.get('/public/triggers', toolRoute('list_triggers', () => ({})));
publicApiRoute.post('/public/triggers', toolRoute('create_trigger', async (c) => await c.req.json()));
publicApiRoute.patch(
  '/public/triggers/:id',
  toolRoute('update_trigger', async (c) => ({ id: c.req.param('id'), ...(await c.req.json()) })),
);
publicApiRoute.delete('/public/triggers/:id', toolRoute('delete_trigger', (c) => ({ id: c.req.param('id') })));
