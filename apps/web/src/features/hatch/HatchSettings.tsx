import { useEffect, useState } from 'react';
import type { TriggerRow, TriggerRunRow } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { useTriggers } from '../../db/queries.js';
import { upsertTrigger, deleteTrigger, uuidv7 } from '../../state/actions.js';
import { listHatchActions, listHatchRuns, testHatchTrigger, type HatchActionMetadata } from '../../api/hatch.js';
import { requestPushPermissionPrompt } from '../../lib/push-prompt.js';
import { formatDateTimeJst } from '../../lib/datetime.js';
import { HATCH_EVENT_LABELS, HATCH_ACTION_LABELS, HATCH_RUN_STATUS_LABELS } from './hatch-labels.js';
import { TriggerForm, type TriggerDraft } from './TriggerForm.js';

function useHatchActions(): HatchActionMetadata[] {
  const [actions, setActions] = useState<HatchActionMetadata[]>([]);
  useEffect(() => {
    listHatchActions()
      .then(setActions)
      .catch(() => setActions([]));
  }, []);
  return actions;
}

/** トリガーごとの実行履歴。長い一覧が全Hatch分まとめて出てくると見づらいので、
 * それぞれのHatch行の下に折りたたみで持たせる（ユーザーフィードバック対応） */
function TriggerRunHistory({ triggerId, refreshSignal }: { triggerId: string; refreshSignal: number }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<TriggerRunRow[] | null>(null);

  const load = () => {
    listHatchRuns(triggerId)
      .then(setRuns)
      .catch(() => setRuns([]));
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) load();
  };

  useEffect(() => {
    if (open) load();
  }, [refreshSignal]);

  return (
    <div className="mt-1">
      <button onClick={toggle} className="text-neutral-400 hover:underline">
        {open ? '実行履歴を隠す' : '実行履歴を見る'}
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-1 border-t border-neutral-100 pt-1 dark:border-neutral-800">
          {runs === null && <li className="text-neutral-400">読み込み中…</li>}
          {runs !== null && runs.length === 0 && <li className="text-neutral-400">実行履歴はありません</li>}
          {runs?.slice(0, 20).map((r) => (
            <li key={r.id} className="flex items-baseline gap-2" title={r.error ?? r.output}>
              <span className="shrink-0 text-neutral-500 dark:text-neutral-300">
                {HATCH_RUN_STATUS_LABELS[r.status] ?? r.status}
              </span>
              <span className="shrink-0">{formatDateTimeJst(r.created_at)}</span>
              {r.error ? (
                <span className="min-w-0 flex-1 truncate text-red-500">{r.error}</span>
              ) : (
                <span className="min-w-0 flex-1 truncate">{r.output}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HatchSettings({ onClose }: { onClose: () => void }) {
  const { me } = useApp();
  const triggers = useTriggers();
  const actions = useHatchActions();
  const [editingId, setEditingId] = useState<string | null | 'new'>(null);
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});
  const [testCountdown, setTestCountdown] = useState<Record<string, number>>({});
  const [runsRefreshSignal, setRunsRefreshSignal] = useState<Record<string, number>>({});

  if (!me) return null;

  const editingTrigger: TriggerRow | null =
    editingId && editingId !== 'new' ? (triggers.find((t) => t.id === editingId) ?? null) : null;

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
    if (draft.enabled && draft.action_key === 'push_notify') {
      requestPushPermissionPrompt('Hatchの').catch(() => {});
    }
    setEditingId(null);
  };

  const handleToggleEnabled = (t: TriggerRow) => {
    upsertTrigger(me.id, t.id, { enabled: t.enabled === 1 ? 0 : 1 });
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
    setRunsRefreshSignal((s) => ({ ...s, [trigger.id]: (s[trigger.id] ?? 0) + 1 }));
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleEnabled(t)}
                      title={t.enabled === 1 ? '無効にする' : '有効にする'}
                      aria-label={t.enabled === 1 ? '無効にする' : '有効にする'}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                        t.enabled === 1 ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-700'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                          t.enabled === 1 ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="font-medium">{t.name}</span>
                    {t.enabled === 0 && <span className="text-neutral-400">（無効）</span>}
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
                <TriggerRunHistory triggerId={t.id} refreshSignal={runsRefreshSignal[t.id] ?? 0} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
