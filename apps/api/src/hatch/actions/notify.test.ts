import { describe, expect, it, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../../test-utils/db.js';
import { loadEnv } from '../../env.js';
import { parseKeyedEnvList, runDiscordNotify } from './notify.js';

describe('parseKeyedEnvList', () => {
  it('"key:value,key2:value2" 形式をパースする', () => {
    expect(parseKeyedEnvList('foo:https://a.example,bar:https://b.example')).toEqual({
      foo: 'https://a.example',
      bar: 'https://b.example',
    });
  });

  it('空文字は空オブジェクトになる', () => {
    expect(parseKeyedEnvList('')).toEqual({});
  });

  it('コロンが無いペアは無視する', () => {
    expect(parseKeyedEnvList('malformed,foo:https://a.example')).toEqual({ foo: 'https://a.example' });
  });
});

describe('runDiscordNotify', () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
    vi.unstubAllGlobals();
  });

  it('登録済みwebhookにテンプレート展開済みメッセージをPOSTする', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    const taskId = insertTestTask(db, userId, listId, '買い物');

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const env = loadEnv({ DISCORD_WEBHOOKS: 'main:https://discord.example/webhook' });
    await runDiscordNotify(db, env, taskId, { webhook_key: 'main', message_template: '完了: {{task.title}}' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.example/webhook',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { content: string };
    expect(body.content).toBe('完了: 買い物');
  });

  it('未登録のwebhook_keyはエラーになる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    const env = loadEnv({ DISCORD_WEBHOOKS: '' });

    await expect(runDiscordNotify(db, env, null, { webhook_key: 'missing', message_template: 'x' })).rejects.toThrow(
      'discord webhook not registered',
    );
  });

  it('webhookがエラーレスポンスを返すと例外になる', async () => {
    db = createTestDb();
    const userId = uuidv7();
    insertTestUser(db, userId);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const env = loadEnv({ DISCORD_WEBHOOKS: 'main:https://discord.example/webhook' });
    await expect(
      runDiscordNotify(db, env, null, { webhook_key: 'main', message_template: 'x' }),
    ).rejects.toThrow('discord webhook failed: 500');
  });
});
