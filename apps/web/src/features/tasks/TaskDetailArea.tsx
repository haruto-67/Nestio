import { useEffect, useState } from 'react';
import { useResizableWidth } from '../../lib/useResizableWidth.js';
import { TaskDetailPanel } from './TaskDetailPanel.js';
import { TaskDetailPlaceholder } from './TaskDetailPlaceholder.js';

const CLOSE_ANIMATION_MS = 180;

interface TaskDetailAreaProps {
  taskId: string | null;
  onClose: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onSelectTask: (taskId: string) => void;
  onCreateAndSelectTask: (taskId: string) => void;
  autoFocusTitle?: boolean;
  onTitleFocused?: () => void;
}

/**
 * タスク詳細パネルの表示領域（改修6回目）。パネルの開閉に関わらず常に同じ幅ぶんの
 * スペースを確保し（一覧の幅がガクガク変わらないように）、リサイズハンドルもここで一括管理する。
 * 未選択時はTaskDetailPlaceholderを表示し、閉じる時は一瞬スライドアウトさせてから
 * プレースホルダーへ切り替える
 */
export function TaskDetailArea({ taskId, onClose, ...panelProps }: TaskDetailAreaProps) {
  const panelResize = useResizableWidth('nestio_detail_panel_width', 320, 220, 1400);
  const [displayedTaskId, setDisplayedTaskId] = useState(taskId);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (taskId) {
      setDisplayedTaskId(taskId);
      setClosing(false);
      return;
    }
    if (!displayedTaskId) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setDisplayedTaskId(null);
      setClosing(false);
    }, CLOSE_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [taskId, displayedTaskId]);

  // 常時スペース確保はPC幅限定（ユーザー要望通り）。モバイル幅では未選択時は元通り非表示にし、
  // タスク一覧の表示領域を圧迫しない。選択中は幅を問わず表示する
  const visibilityClass = displayedTaskId ? 'flex' : 'hidden md:flex';

  return (
    <div className={`relative h-full shrink-0 ${visibilityClass}`} style={{ width: panelResize.width }}>
      {/* ハンドルは非スクロールの外枠に置く。asideの内側に置くと（改修5回目で判明）
          absolute配置がaside自身のスクロールに巻き込まれ、スクロール後に見失いやすくなる */}
      <div
        onMouseDown={(e) => panelResize.startResize(-1)(e)}
        title="ドラッグして幅を変更"
        className="group absolute top-0 left-0 z-10 h-full w-3 -translate-x-1/2 cursor-col-resize touch-none"
      >
        <div className="mx-auto h-full w-1 group-hover:bg-blue-400/60" />
      </div>
      <div className={`h-full w-full ${closing ? 'nestio-panel-slide-out' : 'nestio-panel-slide-in'}`}>
        {displayedTaskId ? (
          <TaskDetailPanel taskId={displayedTaskId} onClose={onClose} {...panelProps} />
        ) : (
          <TaskDetailPlaceholder />
        )}
      </div>
    </div>
  );
}
