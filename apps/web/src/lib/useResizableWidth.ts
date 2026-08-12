import { useEffect, useRef, useState } from 'react';

/**
 * PC表示時、サイドバーやタスク詳細パネルの幅をドラッグで調整できるようにする。
 * デバイスごとのウィンドウサイズの好みなのでlocalStorageのみに保存する（同期しない）
 */
export function useResizableWidth(storageKey: string, defaultWidth: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored >= min && stored <= max ? stored : defaultWidth;
  });
  const draggingRef = useRef<{ startX: number; startWidth: number; direction: 1 | -1 } | null>(null);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const drag = draggingRef.current;
      if (!drag) return;
      const delta = (e.clientX - drag.startX) * drag.direction;
      const next = Math.min(max, Math.max(min, drag.startWidth + delta));
      setWidth(next);
    }
    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = null;
      document.body.style.userSelect = '';
      setWidth((w) => {
        localStorage.setItem(storageKey, String(w));
        return w;
      });
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [storageKey, min, max]);

  /**
   * direction: ハンドルが右端にある場合は1（右へドラッグで拡大）、左端にある場合は-1。
   * preventDefault()だけだとブラウザによってはドラッグ中にハンドル以外の場所を通過した際
   * テキストが選択されてしまうことがあるため、ドラッグ中はbody全体でuser-selectを止める
   * （PCで幅変更時に文字がドラッグ選択されてしまうという指摘への対応）
   */
  const startResize = (direction: 1 | -1) => (e: { clientX: number; preventDefault: () => void }) => {
    e.preventDefault();
    document.body.style.userSelect = 'none';
    draggingRef.current = { startX: e.clientX, startWidth: width, direction };
  };

  return { width, startResize };
}
