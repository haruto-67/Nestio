/**
 * カスタマイズ可能なショートカット。以前は「今日へ」「優先度」等はカスタマイズ不可の固定
 * ショートカットにしていたが、それも変えたいという要望を受けキーマップへ統合した（改修11回目
 * フォローアップ）。優先度は1action-4keyにはできないため、優先度ごとに別アクションへ分割している。
 *
 * 全アクションのデフォルト値は修飾キー（Ctrl/Cmd・Shift）必須にしてある（改修11回目）。
 * 無修飾の文字キーはどれもエクスプローラー風のタイプアヘッド（頭文字ジャンプ）に使うため、
 * デフォルトではショートカットと衝突させない。ただし、ユーザー自身が意図して無修飾の文字キーへ
 * 再割り当てすることは許可する（タイプアヘッドより自分のショートカットを優先したい場合があるため。
 * 改修11回目フォローアップ）。
 * Altは使わない：Mac(Option)ではAlt+文字が特殊記号を生成しe.keyが変わってしまい、
 * ショートカットとして機能しなくなるため。単一のCtrl+文字も避け、Ctrl+Shift+文字を基本形にした
 * （単独のCtrl+文字はブラウザ側の予約（新規タブ・タブ切替等）と衝突しやすく、Ctrl+Shift+文字の
 * 方が衝突が少ない。既存のCtrl+Shift+l（テーマ切替）が複数改修を経て問題なく動いていた実績を踏襲）
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
  'switch_screen',
  'goto_today',
  'priority_none',
  'priority_low',
  'priority_mid',
  'priority_high',
  'focus_title',
  'focus_sidebar',
  'activate',
  'goto_first',
  'goto_last',
] as const;

export type KeymapAction = (typeof KEYMAP_ACTIONS)[number];

export const DEFAULT_KEYMAP: Record<KeymapAction, string> = {
  quick_add: 'Ctrl+Shift+n',
  search: 'Ctrl+Shift+f',
  toggle_complete: 'Space',
  move_up: 'Ctrl+Shift+k',
  move_down: 'Ctrl+Shift+j',
  indent: 'Tab',
  outdent: 'Shift+Tab',
  delete: 'Delete',
  toggle_theme: 'Ctrl+Shift+l',
  show_help: 'Ctrl+Shift+/',
  add_subtask: 'Ctrl+Shift+a',
  add_sibling_subtask: 'Shift+a',
  switch_screen: 'Ctrl+Shift+m',
  goto_today: 'Ctrl+Shift+t',
  priority_none: 'Ctrl+Shift+1',
  priority_low: 'Ctrl+Shift+2',
  priority_mid: 'Ctrl+Shift+3',
  priority_high: 'Ctrl+Shift+4',
  focus_title: 'Ctrl+Shift+e',
  focus_sidebar: 'Ctrl+Shift+h',
  activate: 'Enter',
  goto_first: 'Home',
  goto_last: 'End',
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
  switch_screen: 'タスク/メモ画面を切り替え',
  goto_today: '「今日」ビューへ',
  priority_none: '優先度をなしに変更',
  priority_low: '優先度を低に変更',
  priority_mid: '優先度を中に変更',
  priority_high: '優先度を高に変更',
  focus_title: '選択中タスクのタイトル欄へフォーカス',
  focus_sidebar: '左側のサイドバーへフォーカス',
  activate: '選択中の項目を開く/折りたたみ切替',
  goto_first: '先頭の項目へ移動',
  goto_last: '末尾の項目へ移動',
};

/** キー入力が「タイプアヘッド候補」になり得るか（=修飾キー無しの1文字入力か）を判定する */
export function isBareCharCombo(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'key'>): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && e.key !== ' ';
}

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

/**
 * KeyboardEventを "Cmd+Shift+l" のような比較可能な文字列に正規化する。
 * CtrlキーとCmd(Meta)キーを別々の文字列として区別する（改修11回目フォローアップ：
 * Macで両方が「Ctrl」に統合されてしまい使い分けられないという指摘への対応）。
 * デフォルトキーマップは全て「Ctrl+…」表記で、どちらのキーでも動く後方互換の判定は
 * normalizeKeyComboUnified で別途行う
 */
export function normalizeKeyCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join('+');
}

/** normalizeKeyComboと同じだが、CtrlとCmdを区別せず両方「Ctrl」として扱う。
 * 「Ctrl+…」で保存された（＝Cmd/Ctrlどちらでも動くことを期待した）既定のキーマップ値との
 * 後方互換マッチに使う */
export function normalizeKeyComboUnified(e: KeyboardEvent): string {
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
