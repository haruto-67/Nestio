import { useEffect, useState } from 'react';
import { subscribePushPrompt } from '../lib/push-prompt.js';
import { enablePushNotifications } from '../lib/push-subscription.js';
import { showToast } from './toast.js';

export function PushPermissionPrompt() {
  const [reason, setReason] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => subscribePushPrompt((detail) => setReason(detail.reason)), []);

  if (!reason) return null;

  const handleEnable = async () => {
    setEnabling(true);
    try {
      await enablePushNotifications();
      showToast('通知を有効にしました');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '通知の有効化に失敗しました');
    } finally {
      setEnabling(false);
      setReason(null);
    }
  };

  return (
    <div className="nestio-modal-panel fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-full bg-neutral-900 px-4 py-2 text-xs text-white shadow-lg dark:bg-white dark:text-neutral-900">
      <span>{reason}通知を有効にしますか？</span>
      <button
        onClick={handleEnable}
        disabled={enabling}
        className="shrink-0 rounded-full bg-blue-500 px-2.5 py-1 font-medium text-white hover:bg-blue-600 disabled:opacity-50"
      >
        {enabling ? '有効化中…' : '有効にする'}
      </button>
      <button
        onClick={() => setReason(null)}
        className="shrink-0 text-neutral-400 hover:text-neutral-200 dark:hover:text-neutral-600"
      >
        閉じる
      </button>
    </div>
  );
}
