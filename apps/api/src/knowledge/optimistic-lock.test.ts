import { describe, expect, it } from 'vitest';
import { checkExpectedSeq } from './optimistic-lock.js';

describe('checkExpectedSeq', () => {
  it('expectedSeqが未指定ならチェックしない', () => {
    expect(checkExpectedSeq('ノート', 5, undefined)).toBeNull();
    expect(checkExpectedSeq('ノート', null, undefined)).toBeNull();
  });

  it('expectedSeqが数値でなければエラー', () => {
    expect(checkExpectedSeq('ノート', 5, '5')).toContain('数値');
  });

  it('ノートが存在しないのにexpectedSeqが指定されたらエラー', () => {
    expect(checkExpectedSeq('ノート', null, 1)).toContain('存在しません');
  });

  it('seqが食い違っていたら競合エラー', () => {
    const message = checkExpectedSeq('ノート', 7, 5);
    expect(message).toContain('競合');
    expect(message).toContain('expected_seq=5');
    expect(message).toContain('現在のseq=7');
  });

  it('seqが一致していれば通す', () => {
    expect(checkExpectedSeq('ノート', 7, 7)).toBeNull();
  });
});
