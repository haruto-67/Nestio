import { useEffect, useRef, useState } from 'react';
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
 * 縦スクロールと横スワイプの判定は最初の移動量（8px）で一度だけ確定する。
 *
 * ReactのonTouchMove（合成イベント）はパフォーマンスのためpassiveで登録され、ハンドラ内で
 * preventDefault()を呼んでも効果が無い（ブラウザは無視し、コンソールに警告が出るだけ）。
 * touch-action CSSクラスの動的切替だけでは、iOS Safari/WKWebViewは一度始まったスクロール
 * ジェスチャーを touch-action の変更で途中キャンセルしてくれないため、横スワイプと判定が
 * 確定した後も縦スクロールが同時に効いてしまっていた（改修21回目フォローアップ：実機で
 * 「まだ横スライド中に縦にスクロールできる」との指摘）。ここでは要素にrefで直接
 * addEventListenerし、touchmoveを{passive: false}で登録することで、横方向と確定した
 * 瞬間から実際にpreventDefault()が効くようにする
 */
export function useSwipeAction({ onSwipeRight, onSwipeLeft, threshold = 80 }: UseSwipeActionOptions) {
  const [translateX, setTranslateX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  // 判定ロジック自体はrefが正（コメント参照）。direction stateは呼び出し側が
  // touch-actionを動的に切り替えるための表示専用ミラー
  const [direction, setDirection] = useState<'horizontal' | 'vertical' | 'edge' | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const directionRef = useRef<'horizontal' | 'vertical' | 'edge' | null>(null);
  const translateXRef = useRef(0);
  // HTMLDivElement固定にしておくと呼び出し側で受け取ったrefをそのままdivのrefへ渡せる
  // （呼び出し側は全てdiv要素にアタッチしているためHTMLElementで汎用化する必要はない）
  const elRef = useRef<HTMLDivElement | null>(null);
  // イベントリスナー登録用useEffectを[]依存のまま保てるよう、最新のコールバックはrefで参照する
  const callbacksRef = useRef({ onSwipeRight, onSwipeLeft });
  callbacksRef.current = { onSwipeRight, onSwipeLeft };

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

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
      // 横方向と確定した以降の全moveイベントで、ブラウザの縦スクロールを実際に止める。
      // stopPropagation()も併せて呼び、この行の外側（例：モバイルメニューのドロワー自体に
      // ついている右→左スワイプで閉じる操作）が同じジェスチャーを二重に拾わないようにする
      e.preventDefault();
      e.stopPropagation();
      translateXRef.current = dx;
      setTranslateX(dx);
    };

    const onTouchEnd = () => {
      setSwiping(false);
      if (directionRef.current === 'horizontal') {
        if (translateXRef.current >= threshold) callbacksRef.current.onSwipeRight?.();
        else if (translateXRef.current <= -threshold) callbacksRef.current.onSwipeLeft?.();
      }
      translateXRef.current = 0;
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
      translateXRef.current = 0;
      setTranslateX(0);
      directionRef.current = null;
      setDirection(null);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchCancel);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [threshold]);

  return { translateX, swiping, direction, ref: elRef };
}
