import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../../test-utils/db.js';
import { loadEnv } from '../../env.js';
import { runClaudeSubtasks } from './claude.js';

describe('runClaudeSubtasks', () => {
  let db: Database.Database;
  let dir: string;
  let userId: string;
  let listId: string;
  let taskId: string;

  beforeEach(() => {
    db = createTestDb();
    userId = 'user-' + Date.now();
    insertTestUser(db, userId);
    listId = insertTestList(db, userId);
    taskId = insertTestTask(db, userId, listId, '週次振り返り');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-claude-subtasks-test-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('claudeの出力を1行1件のサブタスクとして作成する（改修5回目・改修4回目ブレインストーム案D）', async () => {
    const bin = path.join(dir, 'fake-claude.sh');
    fs.writeFileSync(bin, '#!/bin/sh\nprintf "資料をまとめる\\n議事録を送る\\n次回日程を決める\\n"\n');
    fs.chmodSync(bin, 0o755);
    const env = loadEnv({
      NODE_ENV: 'test',
      CLAUDE_BIN: bin,
      CLAUDE_WORKDIR: dir,
      CLAUDE_TIMEOUT_SEC: '5',
    } as unknown as NodeJS.ProcessEnv);

    const result = await runClaudeSubtasks(db, env, userId, taskId, { max_count: 5 });

    expect(result.created).toBe(3);
    const rows = db.prepare('SELECT title, parent_id, list_id FROM tasks WHERE parent_id = ?').all(taskId) as {
      title: string;
      parent_id: string;
      list_id: string;
    }[];
    expect(rows.map((r) => r.title)).toEqual(['資料をまとめる', '議事録を送る', '次回日程を決める']);
    expect(rows.every((r) => r.list_id === listId)).toBe(true);
  });

  it('max_countを超える行は切り捨てる', async () => {
    const bin = path.join(dir, 'fake-claude.sh');
    fs.writeFileSync(bin, '#!/bin/sh\nprintf "A\\nB\\nC\\nD\\n"\n');
    fs.chmodSync(bin, 0o755);
    const env = loadEnv({
      NODE_ENV: 'test',
      CLAUDE_BIN: bin,
      CLAUDE_WORKDIR: dir,
      CLAUDE_TIMEOUT_SEC: '5',
    } as unknown as NodeJS.ProcessEnv);

    const result = await runClaudeSubtasks(db, env, userId, taskId, { max_count: 2 });

    expect(result.created).toBe(2);
  });

  it('CLAUDE_BINが未設定だとエラーになる', async () => {
    const env = loadEnv({ NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv);
    await expect(runClaudeSubtasks(db, env, userId, taskId, { max_count: 5 })).rejects.toThrow();
  });

  it('subjectTaskIdが無いとエラーになる', async () => {
    const bin = path.join(dir, 'fake-claude.sh');
    fs.writeFileSync(bin, '#!/bin/sh\necho A\n');
    fs.chmodSync(bin, 0o755);
    const env = loadEnv({
      NODE_ENV: 'test',
      CLAUDE_BIN: bin,
      CLAUDE_WORKDIR: dir,
    } as unknown as NodeJS.ProcessEnv);

    await expect(runClaudeSubtasks(db, env, userId, null, { max_count: 5 })).rejects.toThrow();
  });
});
