import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { TaskNode } from '../../lib/task-tree.js';
import { formatDateTimeJst, todayJstDateString } from '../../lib/datetime.js';
import { taskDueDateStringJst } from '../../lib/task-views.js';
import { isTaskCollapsed, setTaskCollapsed, subscribeTaskCollapsed } from '../../lib/collapsed-tasks.js';

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

interface TaskItemProps {
  node: TaskNode;
  depth: number;
  canComplete: (taskId: string) => boolean;
  onToggleComplete: (taskId: string, completing: boolean) => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
  onAddSubtask: (taskId: string) => void;
  onDropOntoTask: (draggedTaskId: string, targetTaskId: string) => void;
}

export function TaskItem({
  node,
  depth,
  canComplete,
  onToggleComplete,
  onSelect,
  selectedTaskId,
  onAddSubtask,
  onDropOntoTask,
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
      const timer = setTimeout(() => setJustCompleted(false), 320);
      wasCompletedRef.current = isCompleted;
      return () => clearTimeout(timer);
    }
    wasCompletedRef.current = isCompleted;
  }, [task.completed_at]);

  const dueStr = taskDueDateStringJst(task);
  const today = todayJstDateString();
  const overdue = task.completed_at === null && dueStr !== null && dueStr < today;
  const disabled = task.completed_at === null && !canComplete(task.id);

  const toggleExpanded = () => {
    setExpanded((v) => {
      const next = !v;
      setTaskCollapsed(task.id, !next);
      return next;
    });
  };

  return (
    <div>
      <div
        onClick={() => onSelect(task.id)}
        data-task-row="true"
        draggable
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
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        className={`nestio-row-fade-in group flex cursor-pointer items-center gap-2 rounded border-l-4 py-1.5 pr-2 ${
          task.priority > 0 ? PRIORITY_BORDER_COLOR[task.priority] : 'border-l-transparent'
        } ${
          dragOver
            ? 'bg-blue-100 dark:bg-blue-900/40'
            : selectedTaskId === task.id
              ? 'bg-blue-50 dark:bg-blue-950/40'
              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
        }`}
      >
        {node.children.length > 0 ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpanded();
            }}
            className="w-4 text-xs text-neutral-400"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <input
          type="checkbox"
          checked={task.completed_at !== null}
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleComplete(task.id, e.target.checked)}
          title={disabled ? '未完了のサブタスクがあります' : undefined}
          className={justCompleted ? 'nestio-complete-pop' : undefined}
        />
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
        {task.priority > 0 && (
          <span className={`text-xs ${PRIORITY_COLOR[task.priority]}`}>{PRIORITY_LABEL[task.priority]}</span>
        )}
        {dueStr && (
          <span className={`text-xs ${overdue ? 'text-red-500' : 'text-neutral-400'}`}>
            {task.due_at !== null ? formatDateTimeJst(task.due_at) : dueStr}
          </span>
        )}
      </div>
      {expanded &&
        node.children.map((child) => (
          <TaskItem
            key={child.task.id}
            node={child}
            depth={depth + 1}
            canComplete={canComplete}
            onToggleComplete={onToggleComplete}
            onSelect={onSelect}
            selectedTaskId={selectedTaskId}
            onAddSubtask={onAddSubtask}
            onDropOntoTask={onDropOntoTask}
          />
        ))}
    </div>
  );
}
