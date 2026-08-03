import { execFile } from 'node:child_process';
import type { Env } from '../../env.js';
import { parseKeyedEnvList } from './notify.js';

const SCRIPT_TIMEOUT_MS = 120_000;

/**
 * `.env` の HATCH_SCRIPTS に事前登録済みのスクリプトのみ実行する（ホワイトリスト方式）。
 * ユーザー入力（script_key）はスクリプトパスの検索キーとしてのみ使い、シェルには渡さない。
 */
export function runRegisteredScript(env: Env, params: { script_key: string }): Promise<string> {
  const scripts = parseKeyedEnvList(env.HATCH_SCRIPTS);
  const scriptPath = scripts[params.script_key];
  if (!scriptPath) throw new Error(`script not registered: ${params.script_key}`);

  return new Promise((resolve, reject) => {
    execFile(scriptPath, [], { timeout: SCRIPT_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`script failed: ${error.message}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}
