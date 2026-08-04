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
export function flattenTaskTree(nodes: TaskNode[]): string[] {
  return flattenTaskTreeWithDepth(nodes).map((e) => e.id);
}

export interface FlattenedTaskEntry {
  id: string;
  depth: number;
}

/**
 * ツリーを深さ情報付きで深さ優先展開する。Tabでのインデント対象探索に使う：
 * 「直前に表示されている行」ではなく「同じ深さの直前の兄弟」を正しく見つけるために必要
 * （子孫を挟むと直前の行はより深い階層のことがあるため）
 */
export function flattenTaskTreeWithDepth(nodes: TaskNode[]): FlattenedTaskEntry[] {
  const entries: FlattenedTaskEntry[] = [];
  function walk(list: TaskNode[], depth: number) {
    for (const node of list) {
      entries.push({ id: node.task.id, depth });
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
