import { useEffect, useRef, useState } from 'react';
import { DURATION_BASE_MS } from './motion.js';

/**
 * 詳細パネル（タスク/メモ）の開閉アニメーション時間。CSS側（index.cssの
 * nestio-panel-slide-in/out）のanimation durationと一致させる必要がある（改修12回目：
 * 280msは遅いとのフィードバックで200msへ短縮）。一覧側の非表示化タイミング
 * （useDelayedHide）もこの値に揃える必要がある。値自体はCSS変数
 * --nestio-duration-baseが単一の情報源で、motion.tsがそれを読み取る（改修13回目）
 */
export const PANEL_TRANSITION_MS = DURATION_BASE_MS;

/**
 * activeId（選択中のタスク/メモID）の変化から、パネルに表示すべきID・閉じるアニメーション中か・
 * 再マウント用の世代番号を導出する。閉じる時はactiveIdがnullになった直後もPANEL_TRANSITION_MSの間
 * displayedIdを保持してスライドアウトさせてからnullにする。非表示→表示の遷移でのみ世代番号を
 * 上げ、それをkeyに使うことでCSSアニメーションを確実に再生させる（TaskDetailAreaの元実装を
 * 汎用化。改修12回目でNoteEditorにも展開）
 */
export function usePanelTransition(activeId: string | null): {
  displayedId: string | null;
  closing: boolean;
  generation: number;
} {
  const [displayedId, setDisplayedId] = useState(activeId);
  const [closing, setClosing] = useState(false);
  const generationRef = useRef(0);
  const wasShowingRef = useRef(activeId !== null);

  useEffect(() => {
    if (activeId) {
      if (!wasShowingRef.current) generationRef.current += 1;
      wasShowingRef.current = true;
      setDisplayedId(activeId);
      setClosing(false);
      return;
    }
    wasShowingRef.current = false;
    if (!displayedId) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setDisplayedId(null);
      setClosing(false);
    }, PANEL_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [activeId, displayedId]);

  return { displayedId, closing, generation: generationRef.current };
}

/**
 * hideがtrueになってからPANEL_TRANSITION_MS経過後にtrueを返す。詳細パネルのスライドイン
 * アニメーションが終わるまでは裏の一覧を隠さず透けて見えるようにし、falseになったら
 * （詳細を閉じ始めたら）即座にfalseへ戻して裏の一覧をすぐ見せる（改修12回目：以前は
 * 開いた瞬間に一覧が消え、閉じ切るまで一覧が戻らない不具合があった）
 */
export function useDelayedHide(hide: boolean): boolean {
  const [delayedHide, setDelayedHide] = useState(false);
  useEffect(() => {
    if (!hide) {
      setDelayedHide(false);
      return;
    }
    const timer = setTimeout(() => setDelayedHide(true), PANEL_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [hide]);
  return delayedHide;
}
