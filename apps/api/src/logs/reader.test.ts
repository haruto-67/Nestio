import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRecentLogs } from './reader.js';

function writeLogFile(dir: string, name: string, entries: Record<string, unknown>[]): void {
  fs.writeFileSync(path.join(dir, name), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

describe('readRecentLogs', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-logs-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ログディレクトリが存在しない場合は空配列を返す', () => {
    expect(readRecentLogs(path.join(dir, 'missing'))).toEqual([]);
  });

  it('新しい順（ファイル内は末尾が最新）に返す', () => {
    writeLogFile(dir, 'nestio.2026-08-03.1.log', [
      { level: 30, time: '2026-08-03T00:00:00Z', msg: 'a' },
      { level: 30, time: '2026-08-03T01:00:00Z', msg: 'b' },
    ]);

    const entries = readRecentLogs(dir);

    expect(entries.map((e) => e.msg)).toEqual(['b', 'a']);
  });

  it('新しい日付のファイルを先に読む', () => {
    writeLogFile(dir, 'nestio.2026-08-03.1.log', [{ level: 30, time: 't', msg: 'yesterday' }]);
    writeLogFile(dir, 'nestio.2026-08-04.1.log', [{ level: 30, time: 't', msg: 'today' }]);

    const entries = readRecentLogs(dir);

    expect(entries.map((e) => e.msg)).toEqual(['today', 'yesterday']);
  });

  it('level=errorでlevel>=50のみに絞り込む', () => {
    writeLogFile(dir, 'nestio.2026-08-04.1.log', [
      { level: 30, time: 't', msg: 'info' },
      { level: 50, time: 't', msg: 'error' },
    ]);

    const entries = readRecentLogs(dir, { level: 'error' });

    expect(entries.map((e) => e.msg)).toEqual(['error']);
  });

  it('request_idで絞り込む', () => {
    writeLogFile(dir, 'nestio.2026-08-04.1.log', [
      { level: 30, time: 't', msg: 'a', request_id: 'r1' },
      { level: 30, time: 't', msg: 'b', request_id: 'r2' },
    ]);

    const entries = readRecentLogs(dir, { requestId: 'r2' });

    expect(entries.map((e) => e.msg)).toEqual(['b']);
  });

  it('壊れた行はスキップする', () => {
    fs.writeFileSync(
      path.join(dir, 'nestio.2026-08-04.1.log'),
      '{"level":30,"time":"t","msg":"ok"}\n{broken json\n',
    );

    const entries = readRecentLogs(dir);

    expect(entries.map((e) => e.msg)).toEqual(['ok']);
  });

  it('limitで件数を制限する', () => {
    writeLogFile(dir, 'nestio.2026-08-04.1.log', [
      { level: 30, time: 't', msg: '1' },
      { level: 30, time: 't', msg: '2' },
      { level: 30, time: 't', msg: '3' },
    ]);

    const entries = readRecentLogs(dir, { limit: 2 });

    expect(entries).toHaveLength(2);
  });
});
