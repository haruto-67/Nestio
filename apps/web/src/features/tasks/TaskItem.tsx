import { useEffect, useRef, useState } from 'react';
import { Plus, Check, Trash2 } from 'lucide-react';
import type { TaskNode } from '../../lib/task-tree.js';
import { formatDateTimeJst, todayJstDateString } from '../../lib/datetime.js';
import { taskDueDateStringJst } from '../../lib/task-views.js';
import { isTaskCollapsed, setTaskCollapsed, subscribeTaskCollapsed } from '../../lib/collapsed-tasks.js';
import { isCoarsePointerDevice } from '../../lib/pointer.js';
import { useSwipeAction } from '../../lib/useSwipeAction.js';
import { DURATION_BASE_MS, DURATION_POP_MS } from '../../lib/motion.js';

const PRIORITY_COLOR: Record<number, string> = {
  1: 'text-blue-500',
  2: 'text-amber-500',
  3: 'text-red-500',
};
const PRIORITY_BORDER_COLOR: Record<number, string> = {
  1: 'border-l-blue-400',
  2: 'border-l-amber-400',
  3: 'border-l-red-400',
};
const PRIORITY_LABEL: Record<number, string> = { 1: '低', 2: '中', 3: '高' };
const PRIORITY_QUICK_LABEL: Record<number, string> = { 0: 'なし', 1: '低', 2: '中', 3: '高' };
const PRIORITY_DOT_BG: Record<number, string> = {
  0: 'bg-transparent',
  1: 'bg-blue-400',
  2: 'bg-amber-400',
  3: 'bg-red-400',
};

// 28pxでもまだ「サブタスクのサブタスク」と見分けにくいという指摘（改修10回目）を受けて56pxに拡大。
// 新しい1階層分(56px)が旧2階層分(28px*2=56px)とほぼ同じ見た目になるようにした。
// 固定56pxのままだとスマホ幅では2階層下がっただけでタイトルの表示領域がほぼ無くなり
// 見づらいという指摘（改修21回目）を受け、狭い画面ではclamp()で自動的に縮める
// （PC幅では従来通り56pxのまま変わらない）
const INDENT_PER_DEPTH = 'clamp(24px, 6vw, 56px)';

interface TaskItemProps {
  node: TaskNode;
  depth: number;
  canComplete: (taskId: string) => boolean;
  predecessorTitle: (taskId: string) => string | null;
  onToggleComplete: (taskId: string, completing: boolean) => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
  onAddSubtask: (taskId: string) => void;
  onDropOntoTask: (draggedTaskId: string, targetTaskId: string) => void;
  onDelete: (taskId: string) => void;
  onSetPriority: (taskId: string, priority: 0 | 1 | 2 | 3) => void;
}

export function TaskItem({
  node,
  depth,
  canComplete,
  predecessorTitle,
  onToggleComplete,
  onSelect,
  selectedTaskId,
  onAddSubtask,
  onDropOntoTask,
  onDelete,
  onSetPriority,
}: TaskItemProps) {
  const [expanded, setExpanded] = useState(() => !isTaskCollapsed(node.task.id));
  const [dragOver, setDragOver] = useState(false);
  const { task } = node;

  // インデント操作やドラッグ&ドロップで新しい親になった時、外部から強制展開されることがある
  useEffect(() => subscribeTaskCollapsed(task.id, (collapsed) => setExpanded(!collapsed)), [task.id]);

  // 未完了→完了に変わった瞬間だけチェックボックスをポップさせる（改修4回目 UI改善案2）
  const wasCompletedRef = useRef(task.completed_at !== null);
  const [justCompleted, setJustCompleted] = useState(false);
  useEffect(() => {
    const isCompleted = task.completed_at !== null;
    if (!wasCompletedRef.current && isCompleted) {
      setJustCompleted(true);
      const timer = setTimeout(() => setJustCompleted(false), DURATION_POP_MS);
      wasCompletedRef.current = isCompleted;
      return () => clearTimeout(timer);
    }
    wasCompletedRef.current = isCompleted;
  }, [task.completed_at]);

  const dueStr = taskDueDateStringJst(task);
  const today = todayJstDateString();
  const overdue = task.completed_at === null && dueStr !== null && dueStr < today;
  const blockingPredecessor = task.completed_at === null ? predecessorTitle(task.id) : null;
  const disabled = task.completed_at === null && (!canComplete(task.id) || blockingPredecessor !== null);

  // setStateのアップデーター関数の中で副作用（setTaskCollapsedのdispatchEvent）を呼ぶと、
  // そのイベントを購読している他コンポーネント（TaskListViewのsubscribeAnyTaskCollapsed）の
  // setStateが「別コンポーネントのレンダー中」に呼ばれる形になりReactの警告と実際の更新漏れを
  // 引き起こす（改修14回目で発覚）。値を先に計算してから順にsetStateを呼ぶ形に直す
  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    setTaskCollapsed(task.id, !next);
  };

  // モバイルのタスク行スワイプ（改修13回目）：右スワイプ=完了、左スワイプ=削除。
  // 画面左端からのエッジスワイプ（App.tsx側でドロワーを開く操作）とは行の内部でのみ
  // 発動するため競合しない
  const { translateX, swiping, direction, ref: swipeRef } = useSwipeAction({
    onSwipeRight: () => {
      if (!disabled) onToggleComplete(task.id, task.completed_at === null);
    },
    onSwipeLeft: () => onDelete(task.id),
  });

  return (
    <div>
      <div
        className={`relative overflow-hidden ${direction === 'horizontal' ? 'touch-none' : 'touch-pan-y'}`}
      >
        {translateX !== 0 && (
          <div
            className={`absolute inset-0 flex items-center text-white ${
              translateX > 0 ? 'justify-start bg-emerald-400 pl-4' : 'justify-end bg-red-400 pr-4'
            }`}
          >
            {translateX > 0 ? <Check size={18} /> : <Trash2 size={18} />}
          </div>
        )}
        <div
          onClick={() => onSelect(task.id)}
          data-task-row="true"
          draggable={!isCoarsePointerDevice()}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/nestio-task-id', task.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('text/nestio-task-id')) return;
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            const draggedId = e.dataTransfer.getData('text/nestio-task-id');
            if (draggedId && draggedId !== task.id) onDropOntoTask(draggedId, task.id);
          }}
          ref={swipeRef}
          style={{
            transform: translateX !== 0 ? `translateX(${translateX}px)` : undefined,
            transition: swiping ? 'none' : `transform ${DURATION_BASE_MS}ms ease-out`,
          }}
          className={`nestio-row-fade-in group flex cursor-pointer items-center gap-2 rounded-md border-l-4 bg-[#FBFAF6] py-1.5 pr-2 dark:bg-[#1a1a18] ${
            task.priority > 0 ? PRIORITY_BORDER_COLOR[task.priority] : 'border-l-transparent'
          } ${blockingPredecessor !== null ? 'opacity-50' : ''} ${
            dragOver
              ? 'bg-blue-100 dark:bg-blue-900/40'
              : selectedTaskId === task.id
                ? 'bg-blue-50 dark:bg-blue-950/40'
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
          }`}
        >
        {/* インデント幅はここ（中身を持たないラッパー）にだけ持たせ、中の折りたたみボタン/
            プレースホルダーは常に固定w-8にする（改修21回目フォローアップ）。以前はpaddingLeftを
            ボタン自身に直接付けていたため、ボタン内の▾/▸の文字幅ぶんだけボタン全体が
            min-widthを超えて押し広げられ、その分だけ次のチェックボックスの開始位置が
            プレースホルダーspanの行よりも右にずれてしまい、兄弟タスクなのに階層が1つ
            深いかのように見えるインデントのズレになっていた（「下のものが上の階層に
            いってたりする」という指摘の実体はデータではなくこの見た目のズレだった） */}
        <div
          style={{ paddingLeft: `calc(${depth} * ${INDENT_PER_DEPTH} + 8px)` }}
          className="flex shrink-0"
        >
          {node.children.length > 0 ? (
            // チェックボックスより左側全体（インデント分も含む）を折りたたみボタンの当たり判定にする。
            // 見た目のアイコン自体は変えず、クリック領域だけ広げる（改修8回目）
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded();
              }}
              title={expanded ? 'サブタスクを折りたたむ' : 'サブタスクを展開する'}
              className="flex h-8 w-8 shrink-0 items-center justify-center text-sm text-neutral-400"
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="h-8 w-8 shrink-0" />
          )}
        </div>
        <label
          onClick={(e) => e.stopPropagation()}
          className="flex min-h-8 min-w-8 shrink-0 items-center justify-center"
        >
          <input
            type="checkbox"
            checked={task.completed_at !== null}
            disabled={disabled}
            onChange={(e) => onToggleComplete(task.id, e.target.checked)}
            title={
              blockingPredecessor !== null
                ? `先行タスク「${blockingPredecessor}」が未完了です`
                : disabled
                  ? '未完了のサブタスクがあります'
                  : undefined
            }
            className={`h-4 w-4 ${justCompleted ? 'nestio-complete-pop' : ''}`}
          />
        </label>
        <span
          className={`truncate text-sm ${task.completed_at !== null ? 'text-neutral-400 line-through' : ''}`}
        >
          {task.title}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddSubtask(task.id);
          }}
          title="サブタスクを追加"
          className="flex min-h-8 min-w-8 shrink-0 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <Plus size={14} />
        </button>
        <span className="flex-1" />
        {/* ホバー時に優先度をワンクリックで変更できるミニツールバー（改修13回目：
            キーボードショートカット（Ctrl/Cmd+Shift+1-4）を知らなくても、マウス操作で
            発見的に優先度変更ができるようにする）。PCのホバーでのみ出るため、モバイルでは
            出ない（モバイルはスワイプ操作や詳細パネルで変更する） */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:flex group-hover:opacity-100"
        >
          {([0, 1, 2, 3] as const).map((p) => (
            <button
              key={p}
              onClick={() => onSetPriority(task.id, p)}
              title={`優先度を${PRIORITY_QUICK_LABEL[p]}に変更`}
              className={`h-3 w-3 rounded-full border ${PRIORITY_DOT_BG[p]} ${
                task.priority === p ? 'border-neutral-500 dark:border-neutral-300' : 'border-neutral-300 dark:border-neutral-600'
              }`}
            />
          ))}
        </div>
        {task.priority > 0 && (
          <span className={`text-xs ${PRIORITY_COLOR[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
        )}
        {dueStr && (
          <span className={`text-xs ${overdue ? 'text-red-500' : 'text-neutral-400'}`}>
            {task.due_at !== null ? formatDateTimeJst(task.due_at) : dueStr}
          </span>
        )}
        </div>
      </div>
      {expanded &&
        node.children.map((child) => (
          <TaskItem
            key={child.task.id}
            node={child}
            depth={depth + 1}
            canComplete={canComplete}
            predecessorTitle={predecessorTitle}
            onToggleComplete={onToggleComplete}
            onSelect={onSelect}
            selectedTaskId={selectedTaskId}
            onAddSubtask={onAddSubtask}
            onDropOntoTask={onDropOntoTask}
            onDelete={onDelete}
            onSetPriority={onSetPriority}
          />
        ))}
    </div>
  );
}
