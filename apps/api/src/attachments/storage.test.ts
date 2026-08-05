import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { saveAttachmentFile, readAttachmentFile, attachmentFilePath } from './storage.js';

const KEY = crypto.randomBytes(32).toString('base64');

describe('添付ファイルの暗号化保存（改修5回目）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-attachment-storage-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('鍵未設定なら平文のまま保存・読み出しできる', () => {
    const data = Buffer.from('plain content');
    saveAttachmentFile(dir, 'abc123', data);

    const raw = fs.readFileSync(attachmentFilePath(dir, 'abc123'));
    expect(raw.equals(data)).toBe(true);

    const readBack = readAttachmentFile(dir, 'abc123');
    expect(readBack.equals(data)).toBe(true);
  });

  it('鍵を設定すると暗号化されてディスクに保存され、復号すると元の内容に戻る', () => {
    const data = Buffer.from('secret content');
    saveAttachmentFile(dir, 'def456', data, KEY);

    const raw = fs.readFileSync(attachmentFilePath(dir, 'def456'));
    expect(raw.equals(data)).toBe(false); // 平文のままディスクに残っていないこと
    expect(raw.includes(data)).toBe(false);

    const readBack = readAttachmentFile(dir, 'def456', KEY);
    expect(readBack.equals(data)).toBe(true);
  });

  it('鍵設定前に保存された平文ファイルも、鍵設定後に自動判別して読める（マジックバイト無し）', () => {
    const data = Buffer.from('legacy plain content');
    saveAttachmentFile(dir, 'ghi789', data); // 鍵無しで保存

    const readBack = readAttachmentFile(dir, 'ghi789', KEY); // 鍵ありで読む
    expect(readBack.equals(data)).toBe(true);
  });

  it('間違った鍵で復号しようとするとエラーになる（認証タグ検証に失敗する）', () => {
    const data = Buffer.from('secret content');
    saveAttachmentFile(dir, 'jkl012', data, KEY);

    const wrongKey = crypto.randomBytes(32).toString('base64');
    expect(() => readAttachmentFile(dir, 'jkl012', wrongKey)).toThrow();
  });
});
