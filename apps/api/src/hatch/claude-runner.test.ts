import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runClaudePrompt, ClaudeTimeoutError } from './claude-runner.js';

describe('runClaudePrompt', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-claude-runner-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('プロンプトを引数として渡し、stdoutを返す', async () => {
    const bin = path.join(dir, 'fake-claude.sh');
    fs.writeFileSync(bin, '#!/bin/sh\necho "prompt was: $2"\n');
    fs.chmodSync(bin, 0o755);

    const result = await runClaudePrompt('hello world', { bin, workdir: dir, timeoutSec: 5 });

    expect(result.stdout).toContain('prompt was: hello world');
  });

  it('allowedToolsを指定すると--allowedToolsを渡す', async () => {
    const bin = path.join(dir, 'fake-claude.sh');
    fs.writeFileSync(bin, '#!/bin/sh\necho "args: $@"\n');
    fs.chmodSync(bin, 0o755);

    const result = await runClaudePrompt('p', { bin, workdir: dir, timeoutSec: 5, allowedTools: 'Read,Write' });

    expect(result.stdout).toContain('--allowedTools');
    expect(result.stdout).toContain('Read,Write');
  });

  it('タイムアウトするとClaudeTimeoutErrorになる', async () => {
    const bin = path.join(dir, 'slow-claude.sh');
    fs.writeFileSync(bin, '#!/bin/sh\nsleep 5\n');
    fs.chmodSync(bin, 0o755);

    await expect(runClaudePrompt('p', { bin, workdir: dir, timeoutSec: 0.2 })).rejects.toBeInstanceOf(
      ClaudeTimeoutError,
    );
  });

  it('コマンドが失敗するとエラーになる', async () => {
    const bin = path.join(dir, 'fail-claude.sh');
    fs.writeFileSync(bin, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(bin, 0o755);

    await expect(runClaudePrompt('p', { bin, workdir: dir, timeoutSec: 5 })).rejects.toThrow();
  });
});
