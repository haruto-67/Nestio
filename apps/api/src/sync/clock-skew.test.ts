import { describe, expect, it } from 'vitest';
import { detectClockSkewMs } from './clock-skew.js';

describe('detectClockSkewMs', () => {
  it('opsが無ければundefined', () => {
    expect(detectClockSkewMs([], 1_000_000)).toBeUndefined();
  });

  it('5分以内のずれは無視する', () => {
    const serverNow = 1_000_000;
    const clientNow = serverNow + 4 * 60 * 1000;
    expect(detectClockSkewMs([clientNow], serverNow)).toBeUndefined();
  });

  it('クライアントが未来に進んでいる場合、負の補正値を返す', () => {
    const serverNow = 1_000_000;
    const clientNow = serverNow + 10 * 60 * 1000;
    const skew = detectClockSkewMs([clientNow], serverNow);
    expect(skew).toBe(serverNow - clientNow);
    expect(skew).toBeLessThan(0);
    // クライアントが Date.now() + skew を使うとサーバー時刻に近づく
    expect(clientNow + (skew ?? 0)).toBe(serverNow);
  });

  it('クライアントが過去に遅れている場合、正の補正値を返す', () => {
    const serverNow = 1_000_000;
    const clientNow = serverNow - 10 * 60 * 1000;
    const skew = detectClockSkewMs([clientNow], serverNow);
    expect(skew).toBe(serverNow - clientNow);
    expect(skew).toBeGreaterThan(0);
    expect(clientNow + (skew ?? 0)).toBe(serverNow);
  });

  it('複数opsのうち最新のupdated_atで判定する', () => {
    const serverNow = 1_000_000;
    const farFuture = serverNow + 10 * 60 * 1000;
    const skew = detectClockSkewMs([serverNow, farFuture, serverNow - 1000], serverNow);
    expect(skew).toBe(serverNow - farFuture);
  });
});
