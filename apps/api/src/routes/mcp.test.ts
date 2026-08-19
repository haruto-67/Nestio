import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';

function setupApp(db: Database.Database) {
  const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' } as unknown as NodeJS.ProcessEnv);
  const logger = createLogger(env);
  return createApp(env, db, logger);
}

function insertSession(db: Database.Database, userId: string): string {
  const sessionId = 'test-session-' + uuidv7();
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, Date.now() + 100_000, Date.now());
  return sessionId;
}

function makePkce() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

async function fullOAuthFlow(
  app: ReturnType<typeof setupApp>,
  sessionId: string,
): Promise<{ accessToken: string }> {
  const { codeVerifier, codeChallenge } = makePkce();
  const redirectUri = 'https://claude.example.com/callback';

  const registerRes = await app.request('/api/v1/mcp/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test Client', redirect_uris: [redirectUri] }),
  });
  expect(registerRes.status).toBe(201);
  const { client_id: clientId } = (await registerRes.json()) as { client_id: string };

  const authorizeUrl =
    `/api/v1/mcp/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code_challenge=${codeChallenge}&code_challenge_method=S256&state=xyz`;
  const getAuthorizeRes = await app.request(authorizeUrl, { headers: { Cookie: `nestio_session=${sessionId}` } });
  expect(getAuthorizeRes.status).toBe(200);
  expect(await getAuthorizeRes.text()).toContain('許可する');

  const postAuthorizeRes = await app.request('/api/v1/mcp/oauth/authorize', {
    method: 'POST',
    headers: {
      Cookie: `nestio_session=${sessionId}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      state: 'xyz',
      scope: 'read write',
    }).toString(),
    redirect: 'manual',
  });
  expect(postAuthorizeRes.status).toBe(302);
  const location = postAuthorizeRes.headers.get('Location');
  if (!location) throw new Error('no Location header');
  const code = new URL(location).searchParams.get('code');
  if (!code) throw new Error('no code in redirect');

  const tokenRes = await app.request('/api/v1/mcp/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });
  expect(tokenRes.status).toBe(200);
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
  return { accessToken };
}

async function callTool(
  app: ReturnType<typeof setupApp>,
  accessToken: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await app.request('/api/v1/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: { text: string }[] }; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return JSON.parse(body.result?.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('MCP OAuth + tools', () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it('登録→認可→トークン発行→tools/listまでの一連のフローが動く', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const { accessToken } = await fullOAuthFlow(app, sessionId);
    expect(accessToken).toBeTruthy();

    const toolsRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(toolsRes.status).toBe(200);
    const toolsBody = (await toolsRes.json()) as { result: { tools: { name: string }[] } };
    expect(toolsBody.result.tools.map((t) => t.name)).toContain('list_tasks');
    expect(toolsBody.result.tools.map((t) => t.name)).toContain('create_task');
  });

  it('write権限でcreate_taskを実行できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    // まずリストが必要
    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());

    const callRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { list_id: listId, title: 'MCP経由のタスク' } },
      }),
    });
    expect(callRes.status).toBe(200);
    const body = (await callRes.json()) as { result: { content: { text: string }[] } };
    const created = JSON.parse(body.result.content[0]?.text ?? '{}') as { id: string; title: string };
    expect(created.title).toBe('MCP経由のタスク');

    const row = db.prepare('SELECT title FROM tasks WHERE id = ?').get(created.id) as { title: string };
    expect(row.title).toBe('MCP経由のタスク');
  });

  it('parent_idを指定するとサブタスクとして作成できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());

    const parentRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { list_id: listId, title: '親タスク' } },
      }),
    });
    const parentBody = (await parentRes.json()) as { result: { content: { text: string }[] } };
    const parent = JSON.parse(parentBody.result.content[0]?.text ?? '{}') as { id: string };

    const childRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create_task',
          arguments: { list_id: listId, title: 'サブタスク', parent_id: parent.id },
        },
      }),
    });
    expect(childRes.status).toBe(200);
    const childBody = (await childRes.json()) as { result: { content: { text: string }[] } };
    const child = JSON.parse(childBody.result.content[0]?.text ?? '{}') as { id: string };

    const row = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(child.id) as { parent_id: string };
    expect(row.parent_id).toBe(parent.id);
  });

  it('tagsを指定するとタグを新規作成して紐付ける', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());

    const callRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { list_id: listId, title: 'タグ付きタスク', tags: ['manual'] } },
      }),
    });
    expect(callRes.status).toBe(200);
    const body = (await callRes.json()) as { result: { content: { text: string }[] } };
    const created = JSON.parse(body.result.content[0]?.text ?? '{}') as { id: string };

    const row = db
      .prepare(
        `SELECT tg.name FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = ? AND tt.deleted_at IS NULL`,
      )
      .get(created.id) as { name: string };
    expect(row.name).toBe('manual');
  });

  it('update_noteでメモの内容とpinnedを更新できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const createRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_note', arguments: { title: '元タイトル', body: '元本文' } },
      }),
    });
    const createBody = (await createRes.json()) as { result: { content: { text: string }[] } };
    const created = JSON.parse(createBody.result.content[0]?.text ?? '{}') as { id: string };

    const updateRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'update_note',
          arguments: { id: created.id, title: '新タイトル', body: '新本文', pinned: true },
        },
      }),
    });
    expect(updateRes.status).toBe(200);

    const row = db.prepare('SELECT title, body, pinned FROM notes WHERE id = ?').get(created.id) as {
      title: string;
      body: string;
      pinned: number;
    };
    expect(row.title).toBe('新タイトル');
    // bodyは簡易Markdown→HTML変換を経由して保存される（改修8回目）
    expect(row.body).toBe('<p>新本文</p>');
    expect(row.pinned).toBe(1);
  });

  it('list_lists/create_list/update_list/delete_listでリストを操作できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const folder = await callTool(app, accessToken, 'create_folder', { name: 'フォルダA' });
    const created = await callTool(app, accessToken, 'create_list', {
      name: 'リストA',
      folder_id: folder.id,
      color: '#ff0000',
    });
    expect(created.name).toBe('リストA');

    const listed = (await callTool(app, accessToken, 'list_lists', {})) as unknown as {
      lists: { id: string; name: string; folder_id: string }[];
    };
    expect(listed.lists.some((l) => l.id === created.id && l.folder_id === folder.id)).toBe(true);

    await callTool(app, accessToken, 'update_list', { id: created.id, name: 'リストA改', folder_id: null });
    const row = db.prepare('SELECT name, folder_id FROM lists WHERE id = ?').get(created.id as string) as {
      name: string;
      folder_id: string | null;
    };
    expect(row.name).toBe('リストA改');
    expect(row.folder_id).toBeNull();

    await callTool(app, accessToken, 'delete_list', { id: created.id });
    const deletedRow = db.prepare('SELECT deleted_at FROM lists WHERE id = ?').get(created.id as string) as {
      deleted_at: number | null;
    };
    expect(deletedRow.deleted_at).not.toBeNull();
  });

  it('list_tags/create_tag/update_tag/delete_tagでタグを操作できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const created = await callTool(app, accessToken, 'create_tag', { name: 'urgent', color: '#00ff00' });
    const listed = (await callTool(app, accessToken, 'list_tags', {})) as unknown as {
      tags: { id: string; name: string }[];
    };
    expect(listed.tags.some((t) => t.id === created.id && t.name === 'urgent')).toBe(true);

    await callTool(app, accessToken, 'update_tag', { id: created.id, name: 'urgent2' });
    const row = db.prepare('SELECT name FROM tags WHERE id = ?').get(created.id as string) as { name: string };
    expect(row.name).toBe('urgent2');

    await callTool(app, accessToken, 'delete_tag', { id: created.id });
    const deletedRow = db.prepare('SELECT deleted_at FROM tags WHERE id = ?').get(created.id as string) as {
      deleted_at: number | null;
    };
    expect(deletedRow.deleted_at).not.toBeNull();
  });

  it('delete_task/restore_taskでタスクをゴミ箱に入れて戻せる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());

    const created = await callTool(app, accessToken, 'create_task', { list_id: listId, title: '消すタスク' });
    await callTool(app, accessToken, 'delete_task', { id: created.id });
    const deletedRow = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(created.id as string) as {
      deleted_at: number | null;
    };
    expect(deletedRow.deleted_at).not.toBeNull();

    await callTool(app, accessToken, 'restore_task', { id: created.id });
    const restoredRow = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get(created.id as string) as {
      deleted_at: number | null;
    };
    expect(restoredRow.deleted_at).toBeNull();
  });

  it('update_taskでリスト移動・親付け替え・タグの追加削除ができる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listAId = uuidv7();
    const listBId = uuidv7();
    for (const [id, name] of [
      [listAId, 'A'],
      [listBId, 'B'],
    ]) {
      db.prepare(
        `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
         VALUES (?, ?, NULL, ?, '#888888', 'custom', 1, ?, ?, NULL, 1)`,
      ).run(id, userId, name, Date.now(), Date.now());
    }

    const parent = await callTool(app, accessToken, 'create_task', { list_id: listAId, title: '親' });
    const task = await callTool(app, accessToken, 'create_task', {
      list_id: listAId,
      title: '移動対象',
      tags: ['keep', 'drop'],
    });

    await callTool(app, accessToken, 'update_task', {
      id: task.id,
      list_id: listBId,
      parent_id: parent.id,
      due_date: '2026-09-01',
      remove_tags: ['drop'],
      add_tags: ['added'],
    });

    const row = db
      .prepare('SELECT list_id, parent_id, due_date, due_at FROM tasks WHERE id = ?')
      .get(task.id as string) as {
      list_id: string;
      parent_id: string;
      due_date: string | null;
      due_at: number | null;
    };
    expect(row.list_id).toBe(listBId);
    expect(row.parent_id).toBe(parent.id);
    expect(row.due_date).toBe('2026-09-01');
    expect(row.due_at).toBeNull();

    const tagNames = db
      .prepare(
        `SELECT tg.name FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id
         WHERE tt.task_id = ? AND tt.deleted_at IS NULL ORDER BY tg.name`,
      )
      .all(task.id as string) as { name: string }[];
    expect(tagNames.map((t) => t.name)).toEqual(['added', 'keep']);
  });

  it('update_taskで循環参照になるparent_idはcycle_detectedで拒否される', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());

    const parent = await callTool(app, accessToken, 'create_task', { list_id: listId, title: '親' });
    const child = await callTool(app, accessToken, 'create_task', {
      list_id: listId,
      title: '子',
      parent_id: parent.id,
    });

    await expect(
      callTool(app, accessToken, 'update_task', { id: parent.id, parent_id: child.id }),
    ).rejects.toThrow(/cycle_detected/);
  });

  it('list_triggers/create_trigger/update_trigger/delete_triggerでHatchトリガーを操作できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const created = await callTool(app, accessToken, 'create_trigger', {
      name: '完了時に通知',
      event: 'task_completed',
      action_key: 'push_notify',
      params_json: '{"message":"done"}',
    });

    const listed = (await callTool(app, accessToken, 'list_triggers', {})) as unknown as {
      triggers: { id: string; name: string; enabled: number }[];
    };
    expect(listed.triggers.some((t) => t.id === created.id && t.enabled === 1)).toBe(true);

    await callTool(app, accessToken, 'update_trigger', { id: created.id, enabled: false });
    const row = db.prepare('SELECT enabled FROM triggers WHERE id = ?').get(created.id as string) as {
      enabled: number;
    };
    expect(row.enabled).toBe(0);

    await callTool(app, accessToken, 'delete_trigger', { id: created.id });
    const deletedRow = db.prepare('SELECT deleted_at FROM triggers WHERE id = ?').get(created.id as string) as {
      deleted_at: number | null;
    };
    expect(deletedRow.deleted_at).not.toBeNull();
  });

  it('create_task/create_noteのnote・bodyはMarkdown記法がHTMLに変換されて保存される', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());

    const task = await callTool(app, accessToken, 'create_task', {
      list_id: listId,
      title: 'md task',
      note: '**重要**\n- a\n- b',
    });
    const taskRow = db.prepare('SELECT note FROM tasks WHERE id = ?').get(task.id as string) as { note: string };
    expect(taskRow.note).toBe('<p><b>重要</b></p><ul><li>a</li><li>b</li></ul>');

    const note = await callTool(app, accessToken, 'create_note', { title: 'md note', body: '`code`' });
    const noteRow = db.prepare('SELECT body FROM notes WHERE id = ?').get(note.id as string) as { body: string };
    expect(noteRow.body).toBe('<p><code>code</code></p>');
  });

  // 1x1の黒PNG。改修16回目：upload_attachment/get_attachmentのテスト用固定データ
  const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('upload_attachmentで画像をアップロードし、get_task/list_notesのattachmentsに反映される', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());
    const task = await callTool(app, accessToken, 'create_task', { list_id: listId, title: '画像付きタスク' });

    const uploaded = await callTool(app, accessToken, 'upload_attachment', {
      owner_type: 'task',
      owner_id: task.id,
      filename: 'test.png',
      data_base64: TINY_PNG_BASE64,
    });
    expect(uploaded.url as string).toMatch(/^\/api\/v1\/attachments\/[0-9a-f]{64}$/);
    expect(uploaded.mime).toBe('image/png');

    const fetchedTask = await callTool(app, accessToken, 'get_task', { id: task.id });
    const taskAttachments = fetchedTask.attachments as { filename: string; url: string }[];
    expect(taskAttachments).toHaveLength(1);
    expect(taskAttachments[0]?.filename).toBe('test.png');
    expect(taskAttachments[0]?.url).toBe(uploaded.url);

    const note = await callTool(app, accessToken, 'create_note', { title: 'ノート' });
    await callTool(app, accessToken, 'upload_attachment', {
      owner_type: 'note',
      owner_id: note.id,
      filename: 'note.png',
      data_base64: TINY_PNG_BASE64,
    });
    const listed = (await callTool(app, accessToken, 'list_notes', {})) as unknown as {
      notes: { id: string; attachments: { filename: string }[] }[];
    };
    const foundNote = listed.notes.find((n) => n.id === note.id);
    expect(foundNote?.attachments.map((a) => a.filename)).toEqual(['note.png']);
  });

  it('upload_attachmentは壊れたPNGデータ（CRC不一致）を拒否する', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());
    const task = await callTool(app, accessToken, 'create_task', { list_id: listId, title: 'タスク' });

    const buf = Buffer.from(TINY_PNG_BASE64, 'base64');
    buf[30] = (buf[30] ?? 0) ^ 0xff; // IDATチャンクの1バイトを反転させて破損させる（LLMが長大なbase64を生成する過程で起きる文字化けを模す）
    const brokenBase64 = buf.toString('base64');

    await expect(
      callTool(app, accessToken, 'upload_attachment', {
        owner_type: 'task',
        owner_id: task.id,
        filename: 'broken.png',
        data_base64: brokenBase64,
      }),
    ).rejects.toThrow(/壊れています/);
  });

  it('get_attachmentで画像本体をimage content blockとして取得できる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);
    const { accessToken } = await fullOAuthFlow(app, sessionId);

    const listId = uuidv7();
    db.prepare(
      `INSERT INTO lists (id, user_id, folder_id, name, color, sort_mode, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, NULL, 'Inbox', '#888888', 'custom', 1, ?, ?, NULL, 1)`,
    ).run(listId, userId, Date.now(), Date.now());
    const task = await callTool(app, accessToken, 'create_task', { list_id: listId, title: 'タスク' });
    const uploaded = await callTool(app, accessToken, 'upload_attachment', {
      owner_type: 'task',
      owner_id: task.id,
      filename: 'test.png',
      data_base64: TINY_PNG_BASE64,
    });
    const sha256 = (uploaded.url as string).split('/').pop() as string;

    const res = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'get_attachment', arguments: { sha256 } },
      }),
    });
    const body = (await res.json()) as {
      result: { content: { type: string; data: string; mimeType: string }[] };
    };
    expect(body.result.content[0]?.type).toBe('image');
    expect(body.result.content[0]?.mimeType).toBe('image/png');
    expect(body.result.content[0]?.data).toBe(TINY_PNG_BASE64);
  });

  it('不正なcode_verifierではトークンを発行しない', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const { codeChallenge } = makePkce();
    const redirectUri = 'https://claude.example.com/callback';

    const registerRes = await app.request('/api/v1/mcp/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test Client', redirect_uris: [redirectUri] }),
    });
    const { client_id: clientId } = (await registerRes.json()) as { client_id: string };

    const postAuthorizeRes = await app.request('/api/v1/mcp/oauth/authorize', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        scope: 'read',
      }).toString(),
      redirect: 'manual',
    });
    const location = postAuthorizeRes.headers.get('Location') ?? '';
    const code = new URL(location).searchParams.get('code') ?? '';

    const tokenRes = await app.request('/api/v1/mcp/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: 'wrong-verifier',
      }),
    });
    expect(tokenRes.status).toBe(403);
  });

  it('read権限のトークンでcreate_taskを呼ぶとスコープ不足エラー', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const sessionId = insertSession(db, userId);
    const app = setupApp(db);

    const { codeVerifier, codeChallenge } = makePkce();
    const redirectUri = 'https://claude.example.com/callback';
    const registerRes = await app.request('/api/v1/mcp/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Test Client', redirect_uris: [redirectUri] }),
    });
    const { client_id: clientId } = (await registerRes.json()) as { client_id: string };

    const postAuthorizeRes = await app.request('/api/v1/mcp/oauth/authorize', {
      method: 'POST',
      headers: { Cookie: `nestio_session=${sessionId}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        scope: 'read',
      }).toString(),
      redirect: 'manual',
    });
    const location = postAuthorizeRes.headers.get('Location') ?? '';
    const code = new URL(location).searchParams.get('code') ?? '';

    const tokenRes = await app.request('/api/v1/mcp/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

    const callRes = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { list_id: 'x', title: 'y' } },
      }),
    });
    const body = (await callRes.json()) as { error?: { message: string } };
    expect(body.error?.message).toContain('insufficient scope');
  });

  it('無効なBearerトークンは401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('Bearerヘッダー無しは401', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('Bearerヘッダー無しの401はWWW-AuthenticateでProtected Resource Metadataへ誘導する', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const wwwAuth = res.headers.get('WWW-Authenticate');
    expect(wwwAuth).toContain('resource_metadata=');
    expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
  });

  it('GET /.well-known/oauth-protected-resource はauthorization_serversを返す（RFC 9728）', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toContain('/api/v1/mcp');
    expect(body.authorization_servers[0]).toBe(body.resource);
  });

  it('GET /.well-known/oauth-authorization-server/api/v1/mcp はRFC 8414の正規パスで応答する', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/.well-known/oauth-authorization-server/api/v1/mcp');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { registration_endpoint: string };
    expect(body.registration_endpoint).toContain('/api/v1/mcp/oauth/register');
  });

  it('GET /api/v1/mcp/.well-known/oauth-authorization-server は引き続き既存パスでも応答する', async () => {
    db = createTestDb();
    const app = setupApp(db);
    const res = await app.request('/api/v1/mcp/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
  });
});
