import { useRef, useState, type TouchEvent } from 'react';

interface UseSwipeActionOptions {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  threshold?: number;
}

/**
 * タスク行のスワイプで完了/削除を行うためのタッチジェスチャー（改修13回目）。
 * 右スワイプ=完了、左スワイプ=削除という一般的なTodoアプリの慣習に合わせる。
 * 画面左端からのエッジスワイプ（ドロワーを開く操作、App.tsx側で別途処理）とは、
 * 行の内部でのみ発動するため競合しない。
 * 縦スクロールと横スワイプの判定は最初の移動量（8px）で一度だけ確定し、縦方向と判定したら
 * その後は何もしない（要素にtouch-pan-yを付けブラウザの縦スクロールを妨げない前提）
 */
export function useSwipeAction({ onSwipeRight, onSwipeLeft, threshold = 80 }: UseSwipeActionOptions) {
  const [translateX, setTranslateX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const directionRef = useRef<'horizontal' | 'vertical' | null>(null);

  const onTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    directionRef.current = null;
    setSwiping(true);
  };

  const onTouchMove = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;

    if (!directionRef.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      directionRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }
    if (directionRef.current === 'vertical') return;
    setTranslateX(dx);
  };

  const onTouchEnd = () => {
    setSwiping(false);
    if (directionRef.current === 'horizontal') {
      if (translateX >= threshold) onSwipeRight?.();
      else if (translateX <= -threshold) onSwipeLeft?.();
    }
    setTranslateX(0);
    directionRef.current = null;
  };

  return {
    translateX,
    swiping,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
