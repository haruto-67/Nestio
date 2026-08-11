import { useEffect, useState } from 'react';
import type { TriggerRow, TriggerRunRow } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { useTriggers } from '../../db/queries.js';
import { upsertTrigger, deleteTrigger, uuidv7 } from '../../state/actions.js';
import { listHatchActions, listHatchRuns, testHatchTrigger, type HatchActionMetadata } from '../../api/hatch.js';
import { formatDateTimeJst } from '../../lib/datetime.js';
import { HATCH_EVENT_LABELS, HATCH_ACTION_LABELS, HATCH_RUN_STATUS_LABELS } from './hatch-labels.js';
import { TriggerForm, type TriggerDraft } from './TriggerForm.js';

export function HatchSettings({ onClose }: { onClose: () => void }) {
  const { me } = useApp();
  const triggers = useTriggers();
  const [actions, setActions] = useState<HatchActionMetadata[]>([]);
  const [runs, setRuns] = useState<TriggerRunRow[]>([]);
  const [editingId, setEditingId] = useState<string | null | 'new'>(null);
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});
  const [testCountdown, setTestCountdown] = useState<Record<string, number>>({});

  const refreshRuns = () => {
    listHatchRuns()
      .then(setRuns)
      .catch(() => {});
  };

  useEffect(() => {
    listHatchActions()
      .then(setActions)
      .catch(() => setActions([]));
    refreshRuns();
  }, []);

  if (!me) return null;

  const editingTrigger: TriggerRow | null =
    editingId && editingId !== 'new' ? (triggers.find((t) => t.id === editingId) ?? null) : null;

  // 実行ログに「どのHatchが発火したか」を表示するための名前引き（改修9回目）
  const triggerNameById = new Map(triggers.map((t) => [t.id, t.name]));

  const handleSave = (draft: TriggerDraft) => {
    const id = editingId === 'new' || editingId === null ? uuidv7() : editingId;
    upsertTrigger(me.id, id, {
      name: draft.name,
      event: draft.event,
      condition_json: JSON.stringify(draft.condition),
      action_key: draft.action_key,
      params_json: JSON.stringify(draft.params),
      enabled: draft.enabled ? 1 : 0,
    });
    setEditingId(null);
  };

  // テスト実行ボタンを押してから即発火せず10秒待つ（誤操作防止・心の準備のため）。
  // 待機中はボタン自体が10→0のカウントダウン数字になる（改修9回目）
  const TEST_DELAY_SECONDS = 10;
  const handleTest = async (trigger: TriggerRow) => {
    for (let remaining = TEST_DELAY_SECONDS; remaining > 0; remaining--) {
      setTestCountdown((s) => ({ ...s, [trigger.id]: remaining }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setTestCountdown((s) => {
      const next = { ...s };
      delete next[trigger.id];
      return next;
    });

    setTestStatus((s) => ({ ...s, [trigger.id]: '実行中…' }));
    try {
      const { output } = await testHatchTrigger(trigger.id);
      setTestStatus((s) => ({ ...s, [trigger.id]: `成功: ${output.slice(0, 40)}` }));
    } catch (err) {
      setTestStatus((s) => ({ ...s, [trigger.id]: `失敗: ${err instanceof Error ? err.message : String(err)}` }));
    }
    refreshRuns();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[32rem] flex-col rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-900 nestio-modal-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Hatch トリガー設定</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {editingId !== null ? (
            <TriggerForm
              trigger={editingTrigger}
              actions={actions}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <button
              onClick={() => setEditingId('new')}
              className="mb-3 w-full rounded border border-dashed border-neutral-300 py-2 text-xs text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              + 新規トリガー
            </button>
          )}

          <ul className="mt-3 flex flex-col gap-2">
            {triggers.length === 0 && editingId === null && (
              <li className="text-xs text-neutral-400">トリガーはまだありません</li>
            )}
            {triggers.map((t) => (
              <li key={t.id} className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-700">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{t.name}</span>
                    {t.enabled === 0 && <span className="ml-2 text-neutral-400">（無効）</span>}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleTest(t)}
                      disabled={testCountdown[t.id] !== undefined}
                      title={testCountdown[t.id] !== undefined ? 'この秒数の後にテスト実行されます' : undefined}
                      className={`min-h-8 rounded px-2 hover:underline ${
                        testCountdown[t.id] !== undefined
                          ? 'w-6 text-center font-mono text-neutral-500'
                          : 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                      }`}
                    >
                      {testCountdown[t.id] !== undefined ? testCountdown[t.id] : 'テスト実行'}
                    </button>
                    <button
                      onClick={() => setEditingId(t.id)}
                      className="min-h-8 rounded px-2 text-neutral-500 hover:bg-neutral-100 hover:underline dark:hover:bg-neutral-800"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => deleteTrigger(t.id)}
                      className="min-h-8 rounded px-2 text-red-500 hover:bg-red-50 hover:underline dark:hover:bg-red-950/40"
                    >
                      削除
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-neutral-400">
                  {HATCH_EVENT_LABELS[t.event]} → {HATCH_ACTION_LABELS[t.action_key]}
                </p>
                {testStatus[t.id] && <p className="mt-1 break-all text-neutral-400">{testStatus[t.id]}</p>}
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">実行ログ</span>
              <button onClick={refreshRuns} className="text-xs text-blue-500 hover:underline">
                更新
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {runs.length === 0 && <li className="text-xs text-neutral-400">実行履歴はありません</li>}
              {runs.slice(0, 30).map((r) => (
                <li key={r.id} className="flex items-baseline gap-2 text-xs text-neutral-400" title={r.error ?? r.output}>
                  <span className="shrink-0 text-neutral-500 dark:text-neutral-300">
                    {HATCH_RUN_STATUS_LABELS[r.status] ?? r.status}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-neutral-600 dark:text-neutral-300">
                    {triggerNameById.get(r.trigger_id) ?? '(削除済みのトリガー)'}
                  </span>
                  <span className="shrink-0">{formatDateTimeJst(r.created_at)}</span>
                  {r.error && <span className="min-w-0 shrink truncate text-red-500">{r.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
