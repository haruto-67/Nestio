/**
 * アニメーション速度をCSS変数（apps/web/src/index.cssの:root）から読み取る。
 * 「280ms→200ms」のような速度調整依頼が改修7回目・改修12回目と複数回発生しており、
 * 従来はCSSのanimation-durationとJS側のsetTimeout/transitionを別々に手で
 * 一致させる必要があった（食い違えるとアニメーション終了前に要素が消える等の
 * 不具合になる）。CSS変数を単一の情報源にし、JSはそれを読み取るだけにする（改修13回目）。
 */
function readCssDurationMs(varName: string, fallbackMs: number): number {
  if (typeof document === 'undefined') return fallbackMs;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const ms = parseFloat(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : fallbackMs;
}

/** パネルの開閉・行の出現・スワイプの戻りなど、基準となる速度（:root の --nestio-duration-base） */
export const DURATION_BASE_MS = readCssDurationMs('--nestio-duration-base', 200);

/** 完了チェックのポップ演出の速度（:root の --nestio-duration-pop） */
export const DURATION_POP_MS = readCssDurationMs('--nestio-duration-pop', 320);
