import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, IndentIncrease, IndentDecrease, Plus } from 'lucide-react';
import { uuidv7, type TaskWritableFields, type TaskRow } from '@nestio/shared';
import { MarkdownField } from '../notes/MarkdownField.js';
import { useApp } from '../../state/AppProvider.js';
import { useLists, useTags, useTaskTags, useTasks, useTask } from '../../db/queries.js';
import { upsertTask, deleteTask, upsertTag, upsertTaskTag, deleteTaskTag, completeTask } from '../../state/actions.js';
import { nextSortOrder } from '../../lib/sort-order.js';
import { naturalCollator, todayJstDateString } from '../../lib/datetime.js';
import { RecurrenceEditor } from './RecurrenceEditor.js';
import { AttachmentList } from '../attachments/AttachmentList.js';
import { showToast } from '../../ui/toast.js';
import { useResizableWidth } from '../../lib/useResizableWidth.js';

const PRIORITY_LABELS = ['なし', '低', '中', '高'] as const;

interface TaskDetailPanelProps {
  taskId: string;
  onClose: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onSelectTask: (taskId: string) => void;
}

export function TaskDetailPanel({
  taskId,
  onClose,
  onMoveUp,
  onMoveDown,
  onIndent,
  onOutdent,
  onSelectTask,
}: TaskDetailPanelProps) {
  const { me } = useApp();
  const panelResize = useResizableWidth('nestio_detail_panel_width', 320, 260, 640);
  const task = useTask(taskId);
  const lists = useLists();
  const allTags = useTags();
  const taskTags = useTaskTags();
  const tasks = useTasks();
  const [titleDraft, setTitleDraft] = useState(task?.title ?? '');

  useEffect(() => {
    setTitleDraft(task?.title ?? '');
  }, [task?.title, taskId]);

  if (!task || !me) return null;
  const userId = me.id;

  const update = (fields: TaskWritableFields) => upsertTask(userId, taskId, fields);

  const sortedLists = [...lists].sort((a, b) => naturalCollator.compare(a.name, b.name));
  const taskTagByTagId = new Map(taskTags.filter((tt) => tt.task_id === taskId).map((tt) => [tt.tag_id, tt]));

  const removeTask = () => {
    deleteTask(taskId);
    onClose();
    showToast('削除しました');
  };

  const addSubtask = () => {
    const id = uuidv7();
    const siblings = tasks.filter((t) => t.parent_id === taskId);
    upsertTask(userId, id, {
      list_id: task.list_id,
      parent_id: taskId,
      title: '新しいサブタスク',
      sort_order: nextSortOrder(siblings),
    });
    onSelectTask(id);
    showToast('サブタスクを追加しました');
  };

  const toggleTag = (tagId: string) => {
    const existing = taskTagByTagId.get(tagId);
    if (existing) {
      deleteTaskTag(existing.id);
    } else {
      upsertTaskTag(userId, uuidv7(), { task_id: taskId, tag_id: tagId });
    }
  };

  const createAndAttachTag = (name: string) => {
    const tagId = uuidv7();
    upsertTag(userId, tagId, { name, color: '#888888' });
    upsertTaskTag(userId, uuidv7(), { task_id: taskId, tag_id: tagId });
  };

  return (
    <aside
      data-task-detail-panel="true"
      style={{ width: panelResize.width }}
      className="relative flex h-full shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div
        onMouseDown={(e) => panelResize.startResize(-1)(e)}
        className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-blue-400/40"
      />
      <div className="flex items-center justify-between">
        <button onClick={onClose} className="text-sm text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
          閉じる
        </button>
        <button onClick={removeTask} className="text-sm text-red-500">
          削除
        </button>
      </div>

      <input
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={() => {
          const trimmed = titleDraft.trim();
          if (trimmed && trimmed !== task.title) update({ title: trimmed });
        }}
        className="w-full border-b border-transparent bg-transparent text-lg font-medium outline-none focus:border-blue-400"
      />

      <div className="flex flex-col gap-1 text-xs text-neutral-500">
        並び替え・階層
        <div className="flex gap-1">
          <button
            onClick={onMoveUp}
            title="上へ移動"
            className="flex flex-1 items-center justify-center rounded border border-neutral-200 py-1.5 dark:border-neutral-700"
          >
            <ArrowUp size={14} />
          </button>
          <button
            onClick={onMoveDown}
            title="下へ移動"
            className="flex flex-1 items-center justify-center rounded border border-neutral-200 py-1.5 dark:border-neutral-700"
          >
            <ArrowDown size={14} />
          </button>
          <button
            onClick={onOutdent}
            title="アウトデント（親から出す）"
            className="flex flex-1 items-center justify-center rounded border border-neutral-200 py-1.5 dark:border-neutral-700"
          >
            <IndentDecrease size={14} />
          </button>
          <button
            onClick={onIndent}
            title="インデント（直前のタスクの子にする）"
            className="flex flex-1 items-center justify-center rounded border border-neutral-200 py-1.5 dark:border-neutral-700"
          >
            <IndentIncrease size={14} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs text-neutral-500">
        メモ
        <MarkdownField
          key={taskId}
          value={task.note}
          onSave={(note) => update({ note })}
          ownerType="task"
          ownerId={taskId}
          userId={userId}
          rows={10}
          placeholder="メモを入力（**太字**、_斜体_、画像の貼り付け/ドロップに対応）"
        />
      </div>

      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        リスト
        <select
          value={task.list_id}
          onChange={(e) => update({ list_id: e.target.value })}
          className="rounded border border-neutral-200 bg-transparent p-1.5 text-sm dark:border-neutral-700"
        >
          {sortedLists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1 text-xs text-neutral-500">
        優先度
        <div className="flex gap-1">
          {([0, 1, 2, 3] as const).map((p) => (
            <button
              key={p}
              onClick={() => update({ priority: p })}
              className={`flex-1 rounded border py-1 text-xs ${
                task.priority === p
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40'
                  : 'border-neutral-200 dark:border-neutral-700'
              }`}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <DueEditor task={task} onChange={update} />

      <RecurrenceEditor task={task} onChange={update} />

      <div className="flex flex-col gap-1 text-xs text-neutral-500">
        タグ
        <div className="flex flex-wrap gap-1">
          {allTags.map((t) => {
            const active = taskTagByTagId.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleTag(t.id)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  active ? 'border-transparent text-white' : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'
                }`}
                style={active ? { backgroundColor: t.color } : undefined}
              >
                {t.name}
              </button>
            );
          })}
        </div>
        <TagCreator onCreate={createAndAttachTag} />
      </div>

      <div className="flex flex-col gap-1 text-xs text-neutral-500">
        <div className="flex items-center justify-between">
          <span>サブタスク</span>
          <button onClick={addSubtask} className="flex items-center gap-0.5 text-blue-500">
            <Plus size={12} />
            追加
          </button>
        </div>
        <SubtaskList parentId={taskId} />
      </div>

      <AttachmentList ownerType="task" ownerId={taskId} />
    </aside>
  );
}

type DueMode = 'none' | 'all_day' | 'timed';

function DueEditor({ task, onChange }: { task: TaskRow; onChange: (fields: TaskWritableFields) => void }) {
  const mode: DueMode = task.due_at !== null ? 'timed' : task.due_date !== null ? 'all_day' : 'none';

  const setMode = (next: DueMode) => {
    if (next === 'none') onChange({ due_at: null, due_date: null });
    if (next === 'all_day') onChange({ due_at: null, due_date: todayJstDateString() });
    if (next === 'timed') onChange({ due_date: null, due_at: Date.now() });
  };

  return (
    <div className="flex flex-col gap-1 text-xs text-neutral-500">
      期限
      <div className="flex gap-1">
        {(['none', 'all_day', 'timed'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded border py-1 text-xs ${
              mode === m ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40' : 'border-neutral-200 dark:border-neutral-700'
            }`}
          >
            {m === 'none' ? 'なし' : m === 'all_day' ? '終日' : '時刻指定'}
          </button>
        ))}
      </div>
      {mode === 'all_day' && (
        <input
          type="date"
          value={task.due_date ?? ''}
          onChange={(e) => onChange({ due_date: e.target.value, due_at: null })}
          className="rounded border border-neutral-200 bg-transparent p-1.5 text-sm dark:border-neutral-700"
        />
      )}
      {mode === 'timed' && (
        <input
          type="datetime-local"
          value={task.due_at !== null ? toLocalInputValue(task.due_at) : ''}
          onChange={(e) =>
            onChange({ due_at: e.target.value ? new Date(e.target.value).getTime() : null, due_date: null })
          }
          className="rounded border border-neutral-200 bg-transparent p-1.5 text-sm dark:border-neutral-700"
        />
      )}
    </div>
  );
}

function toLocalInputValue(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TagCreator({ onCreate }: { onCreate: (name: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          onCreate(value.trim());
          setValue('');
        }
      }}
      placeholder="新しいタグ名を入力してEnter"
      className="rounded border border-neutral-200 bg-transparent p-1 text-xs dark:border-neutral-700"
    />
  );
}

function SubtaskList({ parentId }: { parentId: string }) {
  const { me } = useApp();
  const tasks = useTasks();
  const children = tasks.filter((t) => t.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);

  const toggle = (task: TaskRow, completing: boolean) => {
    if (!me) return;
    completeTask(me.id, task, completing);
  };

  return (
    <div className="flex flex-col gap-1">
      {children.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={c.completed_at !== null} onChange={(e) => toggle(c, e.target.checked)} />
          <span className={c.completed_at !== null ? 'text-neutral-400 line-through' : ''}>{c.title}</span>
        </label>
      ))}
    </div>
  );
}
