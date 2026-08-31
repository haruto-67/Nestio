import { useRef, useState, type TouchEvent } from 'react';
import { EDGE_SWIPE_ZONE_PX } from './edge-swipe.js';

interface UseSwipeActionOptions {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  threshold?: number;
}

/**
 * タスク行のスワイプで完了/削除を行うためのタッチジェスチャー（改修13回目）。
 * 右スワイプ=完了、左スワイプ=削除という一般的なTodoアプリの慣習に合わせる。
 * 画面左端からのエッジスワイプ（ドロワーを開く操作、App.tsx側で別途処理）とは、React合成
 * イベントがバブリングするため、開始位置が画面端EDGE_SWIPE_ZONE_PX以内の場合はこちらの
 * ジェスチャー自体を無視する（改修14回目：以前は「行の内部でのみ発動するため競合しない」と
 * していたが、実際には端付近の行をスワイプすると完了/削除とドロワー表示が同時に起きていた）。
 * 縦スクロールと横スワイプの判定は最初の移動量（8px）で一度だけ確定し、縦方向と判定したら
 * その後は何もしない（要素にtouch-pan-yを付けブラウザの縦スクロールを妨げない前提）
 */
export function useSwipeAction({ onSwipeRight, onSwipeLeft, threshold = 80 }: UseSwipeActionOptions) {
  const [translateX, setTranslateX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  // 判定ロジック自体はrefが正（コメント参照）。direction stateは呼び出し側が
  // touch-actionを動的に切り替えるための表示専用ミラー（改修21回目：横スワイプ確定後も
  // ブラウザのtouch-action:pan-yがそのままだと縦スクロールが同時に効いてしまう指摘への対応。
  // horizontalと判定した瞬間にtouch-noneへ切り替え、ブラウザのネイティブ縦スクロールを止める）
  const [direction, setDirection] = useState<'horizontal' | 'vertical' | 'edge' | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const directionRef = useRef<'horizontal' | 'vertical' | 'edge' | null>(null);

  const onTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    if (touch.clientX <= EDGE_SWIPE_ZONE_PX) {
      directionRef.current = 'edge';
      setDirection('edge');
      return;
    }
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    directionRef.current = null;
    setDirection(null);
    setSwiping(true);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (directionRef.current === 'edge') return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;

    if (!directionRef.current) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      const next = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      directionRef.current = next;
      setDirection(next);
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
    setDirection(null);
  };

  // iOSでアプリをバックグラウンドに送る（ホームへスワイプ等）と、進行中のタッチジェスチャーは
  // touchendではなくtouchcancelで終わる（改修16回目：スワイプ操作を意図的にしていないのに
  // ホーム画面から戻ってきたら行に完了/削除の緑/赤背景が残ったまま固まるという報告への対応）。
  // onTouchEndと違い、キャンセルなのでonSwipeRight/onSwipeLeftは呼ばずstateだけリセットする
  const onTouchCancel = () => {
    setSwiping(false);
    setTranslateX(0);
    directionRef.current = null;
    setDirection(null);
  };

  return {
    translateX,
    swiping,
    direction,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}
