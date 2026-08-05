import type { SmartListKey } from '../lib/task-views.js';

export type ViewSelection =
  | { type: 'smart'; key: SmartListKey }
  | { type: 'list'; listId: string }
  | { type: 'custom'; id: string };

export function viewKey(view: ViewSelection): string {
  if (view.type === 'smart') return `smart:${view.key}`;
  if (view.type === 'list') return `list:${view.listId}`;
  return `custom:${view.id}`;
}
