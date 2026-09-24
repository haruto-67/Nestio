import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser } from '../test-utils/db.js';
import { createApp } from '../app.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';

function insertSession(db: Database.Database, userId: string): string {
  const sessionId = 'test-session-' + uuidv7();
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, Date.now() + 100_000, Date.now());
  return sessionId;
}

// 1x1の透明PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe('vault route（改修25回目）', () => {
  let db: Database.Database;
  let vaultDir: string;

  afterEach(() => {
    db?.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  function setup() {
    db = createTestDb();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-vault-route-'));
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', VAULT_DIR: vaultDir } as unknown as NodeJS.ProcessEnv);
    const app = createApp(env, db, createLogger(env));
    const userId = uuidv7();
    insertTestUser(db, userId);
    const cookie = `nestio_session=${insertSession(db, userId)}`;
    const req = (method: string, url: string, body?: unknown) =>
      app.request(`/api/v1${url}`, {
        method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { app, userId, req };
  }

  it('未ログインでは使えない', async () => {
    const { app } = setup();
    const res = await app.request('/api/v1/vault/tree');
    expect(res.status).toBe(401);
  });

  it('作成→ツリー→読み取り→versionを渡して保存でき、古いversionでの保存は409になる', async () => {
    const { req } = setup();
    const created = await req('POST', '/vault/note', {
      path: 'projects/Nestio/Nestio.md',
      description: 'ハブ',
      category: 'project',
    });
    expect(created.status).toBe(201);
    const { version: v1 } = (await created.json()) as { version: string };

    const tree = (await (await req('GET', '/vault/tree')).json()) as { folders: string[]; notes: { path: string }[] };
    expect(tree.folders).toEqual(['projects', 'projects/Nestio']);
    expect(tree.notes.map((n) => n.path)).toEqual(['projects/Nestio/Nestio.md']);

    const note = (await (await req('GET', '/vault/note?path=projects/Nestio/Nestio.md')).json()) as {
      content: string;
      version: string;
    };
    expect(note.version).toBe(v1);

    const saved = await req('PUT', '/vault/note', {
      path: 'projects/Nestio/Nestio.md',
      content: `${note.content}本文を編集\n`,
      version: v1,
    });
    expect(saved.status).toBe(200);

    const stale = await req('PUT', '/vault/note', {
      path: 'projects/Nestio/Nestio.md',
      content: `${note.content}古い画面からの保存\n`,
      version: v1,
    });
    expect(stale.status).toBe(409);
    const reread = (await (await req('GET', '/vault/note?path=projects/Nestio/Nestio.md')).json()) as { body: string };
    expect(reread.body).toBe('本文を編集\n');
  });

  it('バックリンク・リンク解決・移動・削除', async () => {
    const { req } = setup();
    await req('POST', '/vault/note', { path: 'topics/リンク先.md', description: '先', category: 'topic' });
    const src = (await (
      await req('POST', '/vault/note', { path: 'topics/リンク元.md', description: '元', category: 'topic' })
    ).json()) as { version: string };
    const srcNote = (await (await req('GET', '/vault/note?path=topics/リンク元.md')).json()) as { content: string };
    await req('PUT', '/vault/note', { path: 'topics/リンク元.md', content: `${srcNote.content}[[リンク先]]\n`, version: src.version });

    const target = (await (await req('GET', '/vault/note?path=topics/リンク先.md')).json()) as {
      backlinks: { title: string }[];
      version: string;
    };
    expect(target.backlinks.map((b) => b.title)).toEqual(['リンク元']);
    expect(await (await req('GET', '/vault/resolve?title=リンク先')).json()).toEqual({ path: 'topics/リンク先.md' });

    const moved = (await (
      await req('POST', '/vault/move', { path: 'topics/リンク先.md', to: 'topics/改名後.md', version: target.version })
    ).json()) as { rewritten: string[]; version: string };
    expect(moved.rewritten).toEqual(['topics/リンク元.md']);

    const del = await req('DELETE', '/vault/note', { path: 'topics/改名後.md', version: moved.version });
    expect(del.status).toBe(200);
    expect((await req('GET', '/vault/note?path=topics/改名後.md')).status).toBe(404);
  });

  it('Vault外のパスは400、添付はマジックバイトで画像と確認できたものだけnosniff付きで返す', async () => {
    const { req, userId } = setup();
    const bad = await req('POST', '/vault/note', { path: '../外.md', description: 'x', category: 'topic' });
    expect(bad.status).toBe(400);

    const attachDir = path.join(vaultDir, userId, 'attachments');
    fs.mkdirSync(attachDir, { recursive: true });
    fs.writeFileSync(path.join(attachDir, '図.png'), PNG_1PX);
    fs.writeFileSync(path.join(attachDir, '偽装.png'), '<script>alert(1)</script>');

    const img = await req('GET', `/vault/attachments/${encodeURIComponent('図.png')}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toBe('image/png');
    expect(img.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await req('GET', `/vault/attachments/${encodeURIComponent('偽装.png')}`)).status).toBe(404);
  });
});
