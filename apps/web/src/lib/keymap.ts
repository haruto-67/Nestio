/**
 * カスタマイズ可能なショートカット。「G→T」（今日へ）と優先度の1〜4キーは
 * 複合/多対応のキー操作で1action-1keyの単純なマップに乗らないため、固定のままにしている
 * （docs/open-questions.md に判断根拠を記録）。
 */
export const KEYMAP_ACTIONS = [
  'quick_add',
  'search',
  'toggle_complete',
  'move_up',
  'move_down',
  'indent',
  'outdent',
  'delete',
  'toggle_theme',
  'show_help',
  'add_subtask',
  'add_sibling_subtask',
] as const;

export type KeymapAction = (typeof KEYMAP_ACTIONS)[number];

export const DEFAULT_KEYMAP: Record<KeymapAction, string> = {
  quick_add: 'n',
  search: '/',
  toggle_complete: 'Space',
  move_up: 'k',
  move_down: 'j',
  indent: 'Tab',
  outdent: 'Shift+Tab',
  delete: 'Delete',
  toggle_theme: 'Ctrl+Shift+l',
  show_help: '?',
  add_subtask: 'a',
  add_sibling_subtask: 'Shift+A',
};

export const KEYMAP_ACTION_LABELS: Record<KeymapAction, string> = {
  quick_add: 'クイック追加',
  search: '検索',
  toggle_complete: '選択中タスクを完了',
  move_up: '上へ移動',
  move_down: '下へ移動',
  indent: 'サブタスクにする',
  outdent: 'サブタスクから戻す',
  delete: '削除',
  toggle_theme: 'ダーク / ライト切替',
  show_help: 'ショートカット一覧を表示',
  add_subtask: '選択中タスクにサブタスクを追加',
  add_sibling_subtask: '選択中タスクと同じ階層にタスクを追加',
};

export function parseKeymapOverrides(json: string): Partial<Record<KeymapAction, string>> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Partial<Record<KeymapAction, string>>;
    }
  } catch {
    // 壊れたJSONはデフォルトへフォールバック
  }
  return {};
}

export function resolveKeymap(overrides: Partial<Record<KeymapAction, string>>): Record<KeymapAction, string> {
  const result = { ...DEFAULT_KEYMAP };
  for (const action of KEYMAP_ACTIONS) {
    const override = overrides[action];
    if (override) result[action] = override;
  }
  return result;
}

/** 同じキーが複数アクションに割り当てられている組を返す */
export function findKeymapConflicts(keymap: Record<KeymapAction, string>): KeymapAction[][] {
  const byKey = new Map<string, KeymapAction[]>();
  for (const action of KEYMAP_ACTIONS) {
    const key = keymap[action];
    const list = byKey.get(key);
    if (list) list.push(action);
    else byKey.set(key, [action]);
  }
  return [...byKey.values()].filter((list) => list.length > 1);
}

/** KeyboardEventを "Ctrl+Shift+l" のような比較可能な文字列に正規化する */
export function normalizeKeyCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join('+');
}
