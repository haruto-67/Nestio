import { useState, useEffect, type KeyboardEvent } from 'react';
import { Moon, Sun, AlertTriangle } from 'lucide-react';
import { KEYMAP_ACTIONS, KEYMAP_ACTION_LABELS, findKeymapConflicts, normalizeKeyCombo, type KeymapAction } from '../../lib/keymap.js';
import { useKeymap } from '../../state/useKeymap.js';
import { useApp } from '../../state/AppProvider.js';
import { sendClientLogs } from '../../api/client-logs.js';
import { enablePushNotifications, getPushPermissionState } from '../../lib/push-subscription.js';
import { createCalendarFeed, listCalendarFeeds, revokeCalendarFeed, type CalendarFeed } from '../../api/calendar.js';
import { LogViewer } from '../logs/LogViewer.js';

interface KeymapSettingsProps {
  onClose: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function KeymapSettings({ onClose, theme, onToggleTheme }: KeymapSettingsProps) {
  const { keymap, setKey } = useKeymap();
  const { deviceId } = useApp();
  const [capturing, setCapturing] = useState<KeymapAction | null>(null);
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [showLogViewer, setShowLogViewer] = useState(false);

  useEffect(() => {
    getPushPermissionState().then(setPermission).catch(() => setPermission('unsupported'));
    listCalendarFeeds().then(setFeeds).catch(() => {});
  }, []);

  const conflicts = findKeymapConflicts(keymap);
  const conflictActions = new Set(conflicts.flat());

  const handleCapture = (action: KeymapAction) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (capturing !== action) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    setKey(action, normalizeKeyCombo(e.nativeEvent));
    setCapturing(null);
  };

  const handleSendLogs = async () => {
    if (!deviceId) return;
    setLogStatus('送信中…');
    try {
      const count = await sendClientLogs(deviceId);
      setLogStatus(count > 0 ? `${count}件のログを送信しました` : '送信するログはありませんでした');
    } catch (err) {
      setLogStatus('送信に失敗しました');
      console.error(err);
    }
  };

  const handleEnableNotifications = async () => {
    setNotificationStatus('有効化中…');
    try {
      await enablePushNotifications();
      setNotificationStatus('通知を有効にしました');
      setPermission(await getPushPermissionState());
    } catch (err) {
      setNotificationStatus(err instanceof Error ? err.message : '有効化に失敗しました');
    }
  };

  const handleCreateFeed = async () => {
    try {
      const { url } = await createCalendarFeed();
      try {
        await navigator.clipboard.writeText(url);
        setCalendarStatus('URLをコピーしました');
      } catch {
        setCalendarStatus(url);
      }
      setFeeds(await listCalendarFeeds());
    } catch (err) {
      setCalendarStatus('作成に失敗しました');
      console.error(err);
    }
  };

  const handleRevokeFeed = async (id: string) => {
    try {
      await revokeCalendarFeed(id);
      setFeeds(await listCalendarFeeds());
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-96 rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-900 nestio-modal-panel">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">キーボードショートカット設定</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between border-b border-neutral-200 pb-3 dark:border-neutral-800">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">テーマ</span>
          <button
            onClick={onToggleTheme}
            className="flex items-center gap-1.5 rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
            {theme === 'dark' ? 'ダーク' : 'ライト'}
          </button>
        </div>

        {conflicts.length > 0 && (
          <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
            同じキーが複数の操作に割り当てられています。先に定義された操作が優先されます。
          </p>
        )}

        <ul className="flex flex-col gap-1.5 text-sm">
          {KEYMAP_ACTIONS.map((action) => (
            <li key={action} className="flex items-center justify-between gap-3">
              <span
                className={
                  conflictActions.has(action)
                    ? 'text-red-500'
                    : 'text-neutral-500 dark:text-neutral-400'
                }
              >
                {KEYMAP_ACTION_LABELS[action]}
                {conflictActions.has(action) && <AlertTriangle size={12} className="ml-1 inline text-red-500" />}
              </span>
              <button
                onClick={() => setCapturing(action)}
                onKeyDown={handleCapture(action)}
                onBlur={() => setCapturing((c) => (c === action ? null : c))}
                className={`rounded border px-2 py-1 text-xs ${
                  capturing === action
                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40'
                    : 'border-neutral-300 dark:border-neutral-700'
                }`}
              >
                {capturing === action ? 'キーを押してください…' : keymap[action]}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-neutral-400">「今日」へ（G→T）・優先度変更（1〜4）は固定です</p>

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              通知（期限リマインダー・ポモドーロ終了）
            </span>
            {permission === 'granted' ? (
              <span className="text-xs text-emerald-500">有効</span>
            ) : (
              <button
                onClick={handleEnableNotifications}
                disabled={permission === 'unsupported'}
                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {permission === 'unsupported' ? '非対応' : '有効にする'}
              </button>
            )}
          </div>
          {notificationStatus && <p className="mt-1 text-xs text-neutral-400">{notificationStatus}</p>}
        </div>

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">カレンダー購読（ICS）</span>
            <button
              onClick={handleCreateFeed}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              + URLを作成
            </button>
          </div>
          {feeds.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {feeds.map((f) => (
                <li key={f.id} className="flex items-center justify-between text-xs text-neutral-400">
                  <span className="truncate">{f.token.slice(0, 16)}…</span>
                  <button onClick={() => handleRevokeFeed(f.id)} className="text-red-500">
                    失効
                  </button>
                </li>
              ))}
            </ul>
          )}
          {calendarStatus && <p className="mt-1 break-all text-xs text-neutral-400">{calendarStatus}</p>}
        </div>

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">サーバーログ（自分専用）</span>
            <button
              onClick={() => setShowLogViewer(true)}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              開く
            </button>
          </div>
        </div>

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">同期の不具合を報告</span>
            <button
              onClick={handleSendLogs}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              ログを送信
            </button>
          </div>
          {logStatus && <p className="mt-1 text-xs text-neutral-400">{logStatus}</p>}
        </div>
      </div>
      {showLogViewer && <LogViewer onClose={() => setShowLogViewer(false)} />}
    </div>
  );
}
