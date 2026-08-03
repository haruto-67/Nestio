import { describe, expect, it } from 'vitest';
import { uuidv7, isUuid } from './uuid.js';

describe('uuidv7', () => {
  it('UUID形式の文字列を生成する', () => {
    const id = uuidv7();
    expect(isUuid(id)).toBe(true);
  });

  it('バージョン7・バリアント10のビットを持つ', () => {
    const id = uuidv7();
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('生成時刻順に文字列比較でソートできる', async () => {
    const first = uuidv7();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = uuidv7();
    expect(first < second).toBe(true);
  });

  it('連続生成で重複しない', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});
