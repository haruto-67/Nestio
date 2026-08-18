import { useState, type DragEvent } from 'react';
import type { TaskRow } from '@nestio/shared';
import { formatDateTimeJst } from '../../lib/datetime.js';
import { taskDueDateStringJst } from '../../lib/task-views.js';
import { todayJstDateString } from '../../lib/datetime.js';
import { isCoarsePointerDevice } from '../../lib/pointer.js';

const COLUMNS: { priority: number; label: string; accentClass: string }[] = [
  { priority: 3, label: '優先度: 高', accentClass: 'border-t-red-400' },
  { priority: 2, label: '優先度: 中', accentClass: 'border-t-amber-400' },
  { priority: 1, label: '優先度: 低', accentClass: 'border-t-blue-400' },
  { priority: 0, label: '優先度: なし', accentClass: 'border-t-neutral-300 dark:border-t-neutral-700' },
];

interface KanbanBoardProps {
  tasks: TaskRow[];
  onToggleComplete: (taskId: string, completing: boolean) => void;
  onSelect: (taskId: string) => void;
  selectedTaskId: string | null;
  onChangePriority: (taskId: string, priority: number) => void;
  listNameById: Map<string, string>;
  showListName: boolean;
}

/** 優先度を列とするカンバンビュー（改修4回目）。ワークフロー用のステータス列は
 * スキーマに存在しないため（docs/schema.sqlは勝手に変更しない）、既存のpriorityを
 * 列の軸として使い、カードのドラッグ&ドロップで優先度を変更できるようにする */
export function KanbanBoard({
  tasks,
  onToggleComplete,
  onSelect,
  selectedTaskId,
  onChangePriority,
  listNameById,
  showListName,
}: KanbanBoardProps) {
  const [dragOverPriority, setDragOverPriority] = useState<number | null>(null);
  const today = todayJstDateString();

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-2">
      {COLUMNS.map((col) => {
        const columnTasks = tasks.filter((t) => t.priority === col.priority);
        return (
          <div
            key={col.priority}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('text/nestio-task-id')) return;
              e.preventDefault();
              setDragOverPriority(col.priority);
            }}
            onDragLeave={() => setDragOverPriority((p) => (p === col.priority ? null : p))}
            onDrop={(e: DragEvent) => {
              if (!e.dataTransfer.types.includes('text/nestio-task-id')) return;
              e.preventDefault();
              e.stopPropagation();
              setDragOverPriority(null);
              const draggedId = e.dataTransfer.getData('text/nestio-task-id');
              if (draggedId) onChangePriority(draggedId, col.priority);
            }}
            className={`flex w-64 shrink-0 flex-col rounded-md border-t-4 bg-neutral-50 dark:bg-neutral-900 ${col.accentClass} ${
              dragOverPriority === col.priority ? 'ring-2 ring-blue-300' : ''
            }`}
          >
            <div className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted">
              <span>{col.label}</span>
              <span>{columnTasks.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
              {columnTasks.map((task) => {
                const dueStr = taskDueDateStringJst(task);
                const overdue = task.completed_at === null && dueStr !== null && dueStr < today;
                return (
                  <div
                    key={task.id}
                    draggable={!isCoarsePointerDevice()}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/nestio-task-id', task.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onSelect(task.id)}
                    className={`nestio-row-fade-in cursor-pointer rounded-md border border-neutral-200 bg-white p-2 shadow-sm dark:border-neutral-700 dark:bg-neutral-800 ${
                      selectedTaskId === task.id ? 'ring-2 ring-blue-300' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={task.completed_at !== null}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => onToggleComplete(task.id, e.target.checked)}
                        className="mt-0.5"
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${
                          task.completed_at !== null ? 'text-neutral-400 line-through' : ''
                        }`}
                      >
                        {task.title}
                      </span>
                    </div>
                    {(dueStr || (showListName && listNameById.get(task.list_id))) && (
                      <div className="mt-1 flex items-center justify-between gap-2 pl-6 text-[11px] text-neutral-400">
                        {showListName && (
                          <span className="truncate">{listNameById.get(task.list_id)}</span>
                        )}
                        {dueStr && (
                          <span className={overdue ? 'text-red-500' : ''}>
                            {task.due_at !== null ? formatDateTimeJst(task.due_at) : dueStr}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {columnTasks.length === 0 && (
                <p className="px-1 py-2 text-center text-xs text-neutral-300 dark:text-neutral-600">なし</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
