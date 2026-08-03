const CLOCK_SKEW_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * リクエストに含まれるopsの中で最も新しいupdated_atを「クライアントの現在時刻」の近似として扱い、
 * サーバー時刻との差が5分を超えたら補正値を返す（sync-protocol.md 4章）。
 * クライアントは以後 `Date.now() + clock_skew_ms` でupdated_atを作る前提の値。
 */
export function detectClockSkewMs(opUpdatedAts: number[], serverNow = Date.now()): number | undefined {
  if (opUpdatedAts.length === 0) return undefined;

  const clientNow = Math.max(...opUpdatedAts);
  const diff = clientNow - serverNow;

  return Math.abs(diff) > CLOCK_SKEW_THRESHOLD_MS ? serverNow - clientNow : undefined;
}
