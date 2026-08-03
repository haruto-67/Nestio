import type { HatchActionKey, TriggerEvent } from '@nestio/shared';

/** recurrence_spawned は未実装のため選択肢から除外する（docs/open-questions.md 項目14） */
export const HATCH_EVENTS: Exclude<TriggerEvent, 'recurrence_spawned'>[] = [
  'task_created',
  'task_completed',
  'list_all_completed',
  'due_soon',
  'overdue',
  'schedule',
];

export const HATCH_EVENT_LABELS: Record<TriggerEvent, string> = {
  task_created: 'タスク作成時',
  task_completed: 'タスク完了時',
  list_all_completed: 'リスト内が全完了',
  due_soon: '期限が近づいたら',
  overdue: '期限超過',
  schedule: '定時実行',
  recurrence_spawned: '繰り返しの次回発生時（未実装）',
};

export const HATCH_ACTION_LABELS: Record<HatchActionKey, string> = {
  claude_prompt: 'Claudeにプロンプトを実行させる',
  claude_subtasks: 'Claudeにサブタスクを提案させる',
  create_task: 'タスクを作成',
  create_note: 'メモを作成',
  add_tag: 'タグを付与',
  set_priority: '優先度を変更',
  move_to_list: 'リストへ移動',
  push_notify: 'Web Pushで通知',
  discord_notify: 'Discordへ通知',
  run_registered_script: '登録済みスクリプトを実行',
};

export const HATCH_RUN_STATUS_LABELS: Record<string, string> = {
  queued: '待機中',
  running: '実行中',
  succeeded: '成功',
  failed: '失敗',
  timeout: 'タイムアウト',
};
