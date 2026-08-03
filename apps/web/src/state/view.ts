import type { SmartListKey } from '../lib/task-views.js';

export type ViewSelection = { type: 'smart'; key: SmartListKey } | { type: 'list'; listId: string };

export function viewKey(view: ViewSelection): string {
  return view.type === 'smart' ? `smart:${view.key}` : `list:${view.listId}`;
}
