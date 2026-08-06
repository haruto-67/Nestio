/**
 * タッチ主体のデバイスか（改修7回目）。HTML5 Drag and DropはiOS Safari等の主要モバイル
 * ブラウザでタッチ操作をほぼサポートしておらず、`draggable`属性が付いたままだとブラウザが
 * 「スクロールかドラッグ開始か」の判定に失敗し、以後スクロールできなくなる不具合が報告された。
 * タッチ主体の環境では`draggable`を付けないことで、既存のOSブラウザ標準スクロールを優先させる
 * （並び替え自体はタスク詳細パネルの上下ボタンで引き続き行える）。
 */
export function isCoarsePointerDevice(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
