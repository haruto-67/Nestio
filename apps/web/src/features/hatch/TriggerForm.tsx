import { useState } from 'react';
import type { HatchActionKey, TriggerEvent, TriggerRow } from '@nestio/shared';
import { HATCH_TEMPLATE_VARS } from '@nestio/shared';
import { useLists, useTags } from '../../db/queries.js';
import { HATCH_EVENTS, HATCH_EVENT_LABELS, HATCH_ACTION_LABELS } from './hatch-labels.js';
import type { HatchActionMetadata } from '../../api/hatch.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  Mon: '月',
  Tue: '火',
  Wed: '水',
  Thu: '木',
  Fri: '金',
  Sat: '土',
  Sun: '日',
};

const fieldClass =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900';
const labelClass = 'mb-1 block text-xs text-neutral-500 dark:text-neutral-400';

export interface TriggerDraft {
  name: string;
  event: TriggerEvent;
  condition: Record<string, unknown>;
  action_key: HatchActionKey;
  params: Record<string, unknown>;
  enabled: boolean;
}

function draftFromTrigger(trigger: TriggerRow | null): TriggerDraft {
  if (!trigger) {
    return { name: '', event: 'task_completed', condition: {}, action_key: 'push_notify', params: {}, enabled: true };
  }
  let condition: Record<string, unknown> = {};
  let params: Record<string, unknown> = {};
  try {
    condition = JSON.parse(trigger.condition_json || '{}') as Record<string, unknown>;
  } catch {
    condition = {};
  }
  try {
    params = JSON.parse(trigger.params_json || '{}') as Record<string, unknown>;
  } catch {
    params = {};
  }
  return {
    name: trigger.name,
    event: trigger.event,
    condition,
    action_key: trigger.action_key,
    params,
    enabled: trigger.enabled === 1,
  };
}

function ConditionFields({
  event,
  condition,
  onChange,
}: {
  event: TriggerEvent;
  condition: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const lists = useLists();
  const set = (key: string, value: unknown) => onChange({ ...condition, [key]: value });

  if (event === 'task_completed' || event === 'task_created') {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <label className={labelClass}>対象リスト（任意）</label>
          <select
            className={fieldClass}
            value={(condition.list_id as string) ?? ''}
            onChange={(e) => set('list_id', e.target.value || undefined)}
          >
            <option value="">すべてのリスト</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>対象優先度（任意）</label>
          <select
            className={fieldClass}
            value={condition.priority === undefined ? '' : String(condition.priority)}
            onChange={(e) => set('priority', e.target.value === '' ? undefined : Number(e.target.value))}
          >
            <option value="">すべての優先度</option>
            <option value="0">なし</option>
            <option value="1">低</option>
            <option value="2">中</option>
            <option value="3">高</option>
          </select>
        </div>
      </div>
    );
  }

  if (event === 'list_all_completed' || event === 'overdue') {
    return (
      <div>
        <label className={labelClass}>対象リスト（任意・未指定なら全リスト）</label>
        <select
          className={fieldClass}
          value={(condition.list_id as string) ?? ''}
          onChange={(e) => set('list_id', e.target.value || undefined)}
        >
          <option value="">すべてのリスト</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (event === 'due_soon') {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <label className={labelClass}>何分前に通知するか</label>
          <input
            type="number"
            min={1}
            className={fieldClass}
            value={(condition.offset_minutes as number) ?? 30}
            onChange={(e) => set('offset_minutes', Number(e.target.value))}
          />
        </div>
        <div>
          <label className={labelClass}>対象リスト（任意）</label>
          <select
            className={fieldClass}
            value={(condition.list_id as string) ?? ''}
            onChange={(e) => set('list_id', e.target.value || undefined)}
          >
            <option value="">すべてのリスト</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (event === 'schedule') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelClass}>時（0〜23・日本時間）</label>
            <input
              type="number"
              min={0}
              max={23}
              className={fieldClass}
              value={(condition.hour as number) ?? 9}
              onChange={(e) => set('hour', Number(e.target.value))}
            />
          </div>
          <div className="flex-1">
            <label className={labelClass}>分（0〜59）</label>
            <input
              type="number"
              min={0}
              max={59}
              className={fieldClass}
              value={(condition.minute as number) ?? 0}
              onChange={(e) => set('minute', Number(e.target.value))}
            />
          </div>
        </div>
        <div>
          <label className={labelClass}>曜日（任意・未指定なら毎日）</label>
          <select
            className={fieldClass}
            value={(condition.weekday as string) ?? ''}
            onChange={(e) => set('weekday', e.target.value || undefined)}
          >
            <option value="">毎日</option>
            {WEEKDAYS.map((w) => (
              <option key={w} value={w}>
                {WEEKDAY_LABELS[w]}曜日
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return null;
}

function ParamsFields({
  actionKey,
  params,
  onChange,
}: {
  actionKey: HatchActionKey;
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const lists = useLists();
  const tags = useTags();
  const set = (key: string, value: unknown) => onChange({ ...params, [key]: value });
  const templateHint = (
    <p className="text-[11px] text-neutral-400">
      使える変数: {HATCH_TEMPLATE_VARS.map((v) => `{{${v}}}`).join(' ')}
    </p>
  );

  switch (actionKey) {
    case 'claude_prompt':
      return (
        <div className="flex flex-col gap-2">
          <div>
            <label className={labelClass}>プロンプトテンプレート</label>
            <textarea
              className={fieldClass}
              rows={3}
              value={(params.template as string) ?? ''}
              onChange={(e) => set('template', e.target.value)}
            />
            {templateHint}
          </div>
          <div>
            <label className={labelClass}>結果の出力先</label>
            <select
              className={fieldClass}
              value={(params.output as string) ?? 'note'}
              onChange={(e) => set('output', e.target.value)}
            >
              <option value="note">メモとして保存</option>
              <option value="push">Push通知で受け取る</option>
            </select>
          </div>
        </div>
      );
    case 'claude_subtasks':
      return (
        <div>
          <label className={labelClass}>最大サブタスク数</label>
          <input
            type="number"
            min={1}
            max={20}
            className={fieldClass}
            value={(params.max_count as number) ?? 5}
            onChange={(e) => set('max_count', Number(e.target.value))}
          />
        </div>
      );
    case 'create_task':
      return (
        <div className="flex flex-col gap-2">
          <div>
            <label className={labelClass}>作成先リスト</label>
            <select
              className={fieldClass}
              value={(params.list_id as string) ?? ''}
              onChange={(e) => set('list_id', e.target.value)}
            >
              <option value="">選択してください</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>タイトルテンプレート</label>
            <input
              className={fieldClass}
              value={(params.title_template as string) ?? ''}
              onChange={(e) => set('title_template', e.target.value)}
            />
            {templateHint}
          </div>
          <div>
            <label className={labelClass}>期限（今日から何日後・任意）</label>
            <input
              type="number"
              className={fieldClass}
              value={(params.due_offset_days as number) ?? ''}
              onChange={(e) => set('due_offset_days', e.target.value === '' ? undefined : Number(e.target.value))}
            />
          </div>
        </div>
      );
    case 'create_note':
      return (
        <div className="flex flex-col gap-2">
          <div>
            <label className={labelClass}>タイトルテンプレート</label>
            <input
              className={fieldClass}
              value={(params.title_template as string) ?? ''}
              onChange={(e) => set('title_template', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>本文テンプレート</label>
            <textarea
              className={fieldClass}
              rows={3}
              value={(params.body_template as string) ?? ''}
              onChange={(e) => set('body_template', e.target.value)}
            />
            {templateHint}
          </div>
        </div>
      );
    case 'add_tag':
      return (
        <div>
          <label className={labelClass}>付与するタグ</label>
          <select
            className={fieldClass}
            value={(params.tag_id as string) ?? ''}
            onChange={(e) => set('tag_id', e.target.value)}
          >
            <option value="">選択してください</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      );
    case 'set_priority':
      return (
        <div>
          <label className={labelClass}>変更後の優先度</label>
          <select
            className={fieldClass}
            value={params.priority === undefined ? '0' : String(params.priority)}
            onChange={(e) => set('priority', Number(e.target.value))}
          >
            <option value="0">なし</option>
            <option value="1">低</option>
            <option value="2">中</option>
            <option value="3">高</option>
          </select>
        </div>
      );
    case 'move_to_list':
      return (
        <div>
          <label className={labelClass}>移動先リスト</label>
          <select
            className={fieldClass}
            value={(params.list_id as string) ?? ''}
            onChange={(e) => set('list_id', e.target.value)}
          >
            <option value="">選択してください</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      );
    case 'push_notify':
      return (
        <div className="flex flex-col gap-2">
          <div>
            <label className={labelClass}>通知タイトル</label>
            <input
              className={fieldClass}
              value={(params.title as string) ?? ''}
              onChange={(e) => set('title', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>本文</label>
            <input
              className={fieldClass}
              value={(params.body as string) ?? ''}
              onChange={(e) => set('body', e.target.value)}
            />
          </div>
        </div>
      );
    case 'discord_notify':
      return (
        <div className="flex flex-col gap-2">
          <div>
            <label className={labelClass}>Webhookキー（.envで登録済みのキー）</label>
            <input
              className={fieldClass}
              value={(params.webhook_key as string) ?? ''}
              onChange={(e) => set('webhook_key', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>メッセージテンプレート</label>
            <textarea
              className={fieldClass}
              rows={2}
              value={(params.message_template as string) ?? ''}
              onChange={(e) => set('message_template', e.target.value)}
            />
            {templateHint}
          </div>
        </div>
      );
    case 'run_registered_script':
      return (
        <div>
          <label className={labelClass}>スクリプトキー（.envで登録済みのキー）</label>
          <input
            className={fieldClass}
            value={(params.script_key as string) ?? ''}
            onChange={(e) => set('script_key', e.target.value)}
          />
        </div>
      );
    default:
      return null;
  }
}

export function TriggerForm({
  trigger,
  actions,
  onSave,
  onCancel,
}: {
  trigger: TriggerRow | null;
  actions: HatchActionMetadata[];
  onSave: (draft: TriggerDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TriggerDraft>(() => draftFromTrigger(trigger));
  const actionKeys = actions.length > 0 ? actions.map((a) => a.key) : ([draft.action_key] as HatchActionKey[]);

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-700"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <div>
        <label className={labelClass}>名前</label>
        <input
          required
          className={fieldClass}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>

      <div>
        <label className={labelClass}>トリガー条件（いつ）</label>
        <select
          className={fieldClass}
          value={draft.event}
          onChange={(e) => setDraft({ ...draft, event: e.target.value as TriggerEvent, condition: {} })}
        >
          {HATCH_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {HATCH_EVENT_LABELS[ev]}
            </option>
          ))}
        </select>
      </div>
      <ConditionFields
        event={draft.event}
        condition={draft.condition}
        onChange={(condition) => setDraft({ ...draft, condition })}
      />

      <div>
        <label className={labelClass}>実行するアクション（何を）</label>
        <select
          className={fieldClass}
          value={draft.action_key}
          onChange={(e) => setDraft({ ...draft, action_key: e.target.value as HatchActionKey, params: {} })}
        >
          {actionKeys.map((key) => (
            <option key={key} value={key}>
              {HATCH_ACTION_LABELS[key]}
            </option>
          ))}
        </select>
      </div>
      <ParamsFields
        actionKey={draft.action_key}
        params={draft.params}
        onChange={(params) => setDraft({ ...draft, params })}
      />

      <label className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        有効にする
      </label>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          キャンセル
        </button>
        <button type="submit" className="rounded-md bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600">
          保存
        </button>
      </div>
    </form>
  );
}
