import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv } from '../../env.js';
import { runRegisteredScript } from './scripts.js';

describe('runRegisteredScript', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-hatch-script-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('登録済みスクリプトを実行しstdoutを返す', async () => {
    const scriptPath = path.join(dir, 'ok.sh');
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho "hello from script"\n');
    fs.chmodSync(scriptPath, 0o755);
    const env = loadEnv({ HATCH_SCRIPTS: `ok:${scriptPath}` });

    const output = await runRegisteredScript(env, { script_key: 'ok' });

    expect(output).toContain('hello from script');
  });

  it('未登録のscript_keyはエラーになる', () => {
    const env = loadEnv({ HATCH_SCRIPTS: '' });

    expect(() => runRegisteredScript(env, { script_key: 'missing' })).toThrow('script not registered');
  });

  it('スクリプトが失敗するとエラーになる', async () => {
    const scriptPath = path.join(dir, 'fail.sh');
    fs.writeFileSync(scriptPath, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(scriptPath, 0o755);
    const env = loadEnv({ HATCH_SCRIPTS: `bad:${scriptPath}` });

    await expect(runRegisteredScript(env, { script_key: 'bad' })).rejects.toThrow('script failed');
  });
});
