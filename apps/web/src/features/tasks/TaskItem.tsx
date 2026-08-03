import { useState } from 'react';
import type { TaskNode } from '../../lib/task-tree.js';
import { formatDateTimeJst, todayJstDateString } from '../../lib/datetime.js';
import { taskDueDateStringJst } from '../../lib/task-views.js';

const PRIORITY_COLOR: Record<number, string> = {
  1: 'text-blue-500',
  2: 'text-amber-500',
  3: 'text-red-500',
};
const PRIORITY_LABEL: Record<number, string> = { 1: '低', 2: '中', 3: '高' };

interface TaskItemProps {
  node: TaskNode;
  depth: number;
  canComplete: (taskId: string) => boolean;
  onToggleComplete: (taskId: string, completing: boolean) => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
}

export function TaskItem({ node, depth, canComplete, onToggleComplete, onSelect, selectedTaskId }: TaskItemProps) {
  const [expanded, setExpanded] = useState(true);
  const { task } = node;
  const dueStr = taskDueDateStringJst(task);
  const today = todayJstDateString();
  const overdue = task.completed_at === null && dueStr !== null && dueStr < today;
  const disabled = task.completed_at === null && !canComplete(task.id);

  return (
    <div>
      <div
        onClick={() => onSelect(task.id)}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        className={`group flex cursor-pointer items-center gap-2 rounded py-1.5 pr-2 ${
          selectedTaskId === task.id
            ? 'bg-blue-50 dark:bg-blue-950/40'
            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
        }`}
      >
        {node.children.length > 0 ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
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
        />
        <span
          className={`flex-1 truncate text-sm ${
            task.completed_at !== null ? 'text-neutral-400 line-through' : ''
          }`}
        >
          {task.title}
        </span>
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
          />
        ))}
    </div>
  );
}
