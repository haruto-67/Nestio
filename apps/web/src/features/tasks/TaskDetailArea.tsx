import { useResizableWidth } from '../../lib/useResizableWidth.js';
import { usePanelTransition } from '../../lib/panel-transition.js';
import { TaskDetailPanel } from './TaskDetailPanel.js';
import { TaskDetailPlaceholder } from './TaskDetailPlaceholder.js';

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
  const { displayedId: displayedTaskId, closing, generation } = usePanelTransition(taskId);

  // 常時スペース確保はPC幅限定（ユーザー要望通り）。モバイル幅では未選択時は元通り非表示にし、
  // タスク一覧の表示領域を圧迫しない。選択中は幅を問わず表示する
  const visibilityClass = displayedTaskId ? 'flex' : 'hidden md:flex';

  return (
    <div
      // モバイル幅ではPC用の固定パネル幅のまま表示されて画面の左側に寄って見えてしまっていたため
      // （改修11回目）、モバイルでは画面全体を覆うfixedオーバーレイにし、タスク一覧を裏に
      // 見せたまま右から出てくるフルスクリーン遷移にする。PC幅は従来通り常設パネル
      // !important付きのwidth上書きはmax-md（モバイル）限定にする。md:を使うと非importantな
      // 上書きになり、!importantなクラスは常時（PC幅でも）勝ってしまいstyleのwidthを潰してしまう
      // 背景色は敷かない：中身（TaskDetailPanel、bg-white/dark:bg-neutral-900）自体が不透明なので
      // スライドしてきた分だけ裏の一覧が隠れる。外枠に背景色を敷くと、まだスライド中で見えて
      // いいはずの隙間まで塗りつぶしてしまい、開いた瞬間に一覧が消える不具合になっていた（改修12回目）
      className={`fixed inset-0 z-40 h-full max-md:!w-full overflow-x-hidden md:relative md:inset-auto md:z-auto md:shrink-0 ${visibilityClass}`}
      style={{ width: panelResize.width }}
    >
      {/* ハンドルは非スクロールの外枠に置く。asideの内側に置くと（改修5回目で判明）
          absolute配置がaside自身のスクロールに巻き込まれ、スクロール後に見失いやすくなる。
          モバイルではフルスクリーン表示なのでリサイズ操作自体が不要（改修11回目） */}
      <div
        onMouseDown={(e) => panelResize.startResize(-1)(e)}
        title="ドラッグして幅を変更"
        className="group absolute top-0 left-0 z-10 hidden h-full w-3 -translate-x-1/2 cursor-col-resize touch-none md:block"
      >
        <div className="mx-auto h-full w-1 group-hover:bg-blue-400/60" />
      </div>
      <div
        key={generation}
        className={`h-full w-full ${closing ? 'nestio-panel-slide-out' : 'nestio-panel-slide-in'}`}
      >
        {displayedTaskId ? (
          <TaskDetailPanel
            taskId={displayedTaskId}
            onClose={onClose}
            {...panelProps}
            // displayedTaskIdはtaskIdの変化をuseEffect経由で1テンポ遅れて追従するため、
            // 切り替え直後の1レンダーだけ「表示中はまだ前のタスクなのにautoFocusTitleは
            // 新タスク向けにtrue」という食い違いが起きる。そのまま素通しすると前のタスクの
            // タイトル欄を誤ってフォーカス+全選択してしまい、直後に正しいタスクへ表示が
            // 追いついた時には全選択が解除された状態になる（改修9回目：サブタスク作成時に
            // タイトル欄が全選択されない不具合の根本原因）。displayedTaskIdが追いつくまでは
            // autoFocusTitleを渡さない
            autoFocusTitle={panelProps.autoFocusTitle && displayedTaskId === taskId}
          />
        ) : (
          <TaskDetailPlaceholder />
        )}
      </div>
    </div>
  );
}
