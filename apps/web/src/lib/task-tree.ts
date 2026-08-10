import type { TaskRow, ListSortMode } from '@nestio/shared';
import { sortTasks } from './task-sort.js';

export interface TaskNode {
  task: TaskRow;
  children: TaskNode[];
}

/** 無制限ネストの親子関係をツリー化する。各階層は同じsortModeで並べる */
export function buildTaskTree(tasks: TaskRow[], sortMode: ListSortMode): TaskNode[] {
  const byParent = new Map<string | null, TaskRow[]>();
  for (const t of tasks) {
    const key = t.parent_id;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(t);
    else byParent.set(key, [t]);
  }

  function build(parentId: string | null): TaskNode[] {
    const children = sortTasks(byParent.get(parentId) ?? [], sortMode);
    return children.map((task) => ({ task, children: build(task.id) }));
  }

  return build(null);
}

/** ツリーを深さ優先で1列に展開する（J/K移動用） */
export function flattenTaskTree(nodes: TaskNode[], isCollapsed?: (taskId: string) => boolean): string[] {
  return flattenTaskTreeWithDepth(nodes, isCollapsed).map((e) => e.id);
}

export interface FlattenedTaskEntry {
  id: string;
  depth: number;
}

/**
 * ツリーを深さ情報付きで深さ優先展開する。Tabでのインデント対象探索や、選択中タスクの
 * 上下移動（前後の行への選択切り替え）に使う：「直前に表示されている行」ではなく
 * 「同じ深さの直前の兄弟」を正しく見つけるために深さ情報が必要
 * （子孫を挟むと直前の行はより深い階層のことがあるため）。
 * isCollapsedを渡すと、折りたたまれたタスクの子孫は展開結果に含めない
 * （改修8回目：折りたたんで画面上に見えていないタスクが上下移動の対象に
 * 含まれてしまう不具合の修正。isCollapsed省略時は全件展開する従来どおりの挙動）
 */
export function flattenTaskTreeWithDepth(
  nodes: TaskNode[],
  isCollapsed?: (taskId: string) => boolean,
): FlattenedTaskEntry[] {
  const entries: FlattenedTaskEntry[] = [];
  function walk(list: TaskNode[], depth: number) {
    for (const node of list) {
      entries.push({ id: node.task.id, depth });
      if (node.children.length > 0 && isCollapsed?.(node.task.id)) continue;
      walk(node.children, depth + 1);
    }
  }
  walk(nodes, 0);
  return entries;
}

/** taskId の祖先を辿って循環しない範囲でidを集める（フロント側の事前チェック用） */
export function collectAncestorIds(tasks: Map<string, TaskRow>, taskId: string): Set<string> {
  const ancestors = new Set<string>();
  let current = tasks.get(taskId)?.parent_id ?? null;
  while (current && !ancestors.has(current)) {
    ancestors.add(current);
    current = tasks.get(current)?.parent_id ?? null;
  }
  return ancestors;
}
