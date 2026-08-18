import { useEffect, type RefObject } from 'react';

/**
 * refで指定した要素の外側をクリック/タップした時にhandlerを呼ぶ。ポップオーバー・
 * ドロップダウン（絞り込みメニュー・表示方法メニュー・リストのカラーピッカー等）を
 * 外側クリックで自動的に閉じるのに使う（改修13回目：カラーピッカーが外側クリックで
 * 閉じない不具合の修正）。activeがfalseの間はリスナーを登録しない
 */
export function useOutsideClick(ref: RefObject<HTMLElement | null>, handler: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ref, handler, active]);
}
