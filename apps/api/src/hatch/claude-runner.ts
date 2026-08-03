import { execFile } from 'node:child_process';

export interface ClaudeRunOptions {
  bin: string;
  workdir: string;
  timeoutSec: number;
  allowedTools?: string;
}

export interface ClaudeRunResult {
  stdout: string;
  stderr: string;
}

export class ClaudeTimeoutError extends Error {}

/**
 * `claude -p` を実行する。ユーザー入力を直接シェルへ渡さないよう execFile を使い、
 * shell:true は使わない（CLAUDE.md 絶対原則7・要件定義3.10/3.14）。
 */
export function runClaudePrompt(prompt: string, options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const args = ['-p', prompt];
  if (options.allowedTools) {
    args.push('--allowedTools', options.allowedTools);
  }

  return new Promise((resolve, reject) => {
    execFile(
      options.bin,
      args,
      { cwd: options.workdir, timeout: options.timeoutSec * 1000, killSignal: 'SIGTERM' },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed || error.signal === 'SIGTERM') {
            reject(new ClaudeTimeoutError(`claude -p timed out after ${options.timeoutSec}s`));
            return;
          }
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
