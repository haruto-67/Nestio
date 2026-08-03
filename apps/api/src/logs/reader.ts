import fs from 'node:fs';
import path from 'node:path';

export interface LogEntry {
  level: number;
  time: string;
  msg?: string;
  request_id?: string;
  [key: string]: unknown;
}

const LOG_FILE_RE = /^nestio\..*\.log$/;
/** pinoのlevel数値。ERROR以上=50 */
const ERROR_LEVEL = 50;

/** 新しい順（ファイル名の降順＝日付・ローテーション番号の降順）に並べる */
function listLogFiles(logDir: string): string[] {
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((f) => LOG_FILE_RE.test(f))
    .sort()
    .reverse();
}

/**
 * 直近のログを新しい順に返す（アプリ内の簡易ログビューア用、docs/manual-setup.md F章）。
 * 開発時（ファイル出力なし）はディレクトリが存在せず空配列を返す。
 */
export function readRecentLogs(
  logDir: string,
  options: { limit?: number; level?: 'error' | 'all'; requestId?: string } = {},
): LogEntry[] {
  const limit = options.limit ?? 100;
  const files = listLogFiles(logDir);
  const results: LogEntry[] = [];

  for (const file of files) {
    if (results.length >= limit) break;

    const lines = fs.readFileSync(path.join(logDir, file), 'utf-8').split('\n');
    const parsed: LogEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        parsed.push(JSON.parse(line) as LogEntry);
      } catch {
        // 書き込み中の不完全な行はスキップ
      }
    }

    // ファイル内では末尾が最新なので逆順にする
    for (let i = parsed.length - 1; i >= 0; i--) {
      const entry = parsed[i] as LogEntry;
      if (options.level === 'error' && entry.level < ERROR_LEVEL) continue;
      if (options.requestId && entry.request_id !== options.requestId) continue;
      results.push(entry);
      if (results.length >= limit) break;
    }
  }

  return results;
}
