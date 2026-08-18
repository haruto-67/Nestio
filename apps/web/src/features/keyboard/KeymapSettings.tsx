import { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useApp } from '../../state/AppProvider.js';
import { sendClientLogs } from '../../api/client-logs.js';
import { enablePushNotifications, getPushSubscriptionState, type PushSubscriptionState } from '../../lib/push-subscription.js';
import { sendTestPush } from '../../api/push.js';
import { createCalendarFeed, listCalendarFeeds, revokeCalendarFeed, type CalendarFeed } from '../../api/calendar.js';
import { exportAllData, importAllData } from '../../api/export.js';
import { listSessions, revokeSession, type SessionInfo } from '../../api/sessions.js';
import { formatDateTimeJst } from '../../lib/datetime.js';
import { CollapsibleSection } from '../../ui/CollapsibleSection.js';

interface KeymapSettingsProps {
  onClose: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function KeymapSettings({ onClose, theme, onToggleTheme }: KeymapSettingsProps) {
  const { deviceId, me } = useApp();
  const [logStatus, setLogStatus] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [pushState, setPushState] = useState<PushSubscriptionState>({ permission: 'default', subscribed: false });
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [calendarStatus, setCalendarStatus] = useState<string | null>(null);
  const [showFeedNameInput, setShowFeedNameInput] = useState(false);
  const [newFeedName, setNewFeedName] = useState('');
  const [exportImportStatus, setExportImportStatus] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  // 失効/ログアウト処理中のidを覚えておき、ボタンを一時的に無効化する（改修15回目調査：
  // クリックしても見た目が変わらないと誤解してユーザーが連打し、同じセッションIDに対して
  // DELETEが13回近く連続で送られてrate_limitedを引き起こしていたことが本番ログから判明した。
  // 楽観的更新で見た目の反応自体は直したが、連打そのものを防ぐ二重の保険として追加する）
  const [revokingSessionIds, setRevokingSessionIds] = useState<Set<string>>(new Set());
  const [revokingFeedIds, setRevokingFeedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getPushSubscriptionState()
      .then(setPushState)
      .catch(() => setPushState({ permission: 'unsupported', subscribed: false }));
    listCalendarFeeds().then(setFeeds).catch(() => {});
    listSessions().then(setSessions).catch(() => {});
  }, []);

  const handleRevokeSession = async (id: string) => {
    if (revokingSessionIds.has(id)) return;
    setRevokingSessionIds((prev) => new Set(prev).add(id));
    const isCurrent = sessions.find((s) => s.id === id)?.is_current ?? false;
    try {
      await revokeSession(id);
      // listSessions()で再取得して上書きすると、複数件を連続で失効させた時に
      // 後から発行したリクエストの応答が先に返り、先に発行した方の古い応答が
      // 後から届いて上書きしてしまうことがあった（改修14回目フォローアップ：
      // 「行が消えるときと消えないときがある」という報告の原因）。
      // 成功したidをその場でローカルのリストから取り除く楽観的更新にする
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (isCurrent) window.location.reload();
    } catch (err) {
      console.error(err);
      setSessionStatus('ログアウトに失敗しました');
    } finally {
      setRevokingSessionIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
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
      setPushState(await getPushSubscriptionState());
    } catch (err) {
      setNotificationStatus(err instanceof Error ? err.message : '有効化に失敗しました');
    }
  };

  const handleTestNotification = async () => {
    setNotificationStatus('テスト通知を送信中…');
    try {
      const { subscription_count } = await sendTestPush();
      setNotificationStatus(`${subscription_count}件の端末へ送信しました（届かない場合は端末のOS通知設定を確認してください）`);
    } catch (err) {
      setNotificationStatus(err instanceof Error ? err.message : 'テスト通知の送信に失敗しました');
    }
  };

  const handleCreateFeed = async () => {
    try {
      const { url } = await createCalendarFeed(undefined, newFeedName.trim() || undefined);
      try {
        await navigator.clipboard.writeText(url);
        setCalendarStatus('URLをコピーしました');
      } catch {
        setCalendarStatus(url);
      }
      setNewFeedName('');
      setShowFeedNameInput(false);
      setFeeds(await listCalendarFeeds());
    } catch (err) {
      setCalendarStatus('作成に失敗しました');
      console.error(err);
    }
  };

  const handleExport = async () => {
    setExportImportStatus('エクスポート中…');
    try {
      await exportAllData();
      setExportImportStatus('ダウンロードしました');
    } catch (err) {
      setExportImportStatus('エクスポートに失敗しました');
      console.error(err);
    }
  };

  const handleImportFile = async (file: File) => {
    if (!me) return;
    setExportImportStatus('インポート中…');
    try {
      const count = await importAllData(me.id, file);
      setExportImportStatus(`${count}件のデータを取り込みました`);
    } catch (err) {
      setExportImportStatus('インポートに失敗しました（ファイル形式を確認してください）');
      console.error(err);
    }
  };

  const handleRevokeFeed = async (id: string) => {
    if (revokingFeedIds.has(id)) return;
    setRevokingFeedIds((prev) => new Set(prev).add(id));
    try {
      await revokeCalendarFeed(id);
      // handleRevokeSessionと同じ理由（複数件連続失効時のレースコンディション回避）で
      // 楽観的更新にする（改修14回目フォローアップ）
      setFeeds((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      console.error(err);
      setCalendarStatus('失効に失敗しました');
    } finally {
      setRevokingFeedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-96 rounded-xl bg-surface p-4 shadow-lg nestio-modal-panel">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">設定</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between border-b border-neutral-200 pb-3 dark:border-neutral-800">
          <span className="text-xs text-muted">外観（テーマ）</span>
          <button
            onClick={onToggleTheme}
            className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
            {theme === 'dark' ? 'ダーク' : 'ライト'}
          </button>
        </div>

        <p className="mb-3 text-xs text-neutral-400">
          キーボードショートカットの割り当ては、ヘッダーのキーボードアイコンから変更できます
        </p>

        <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              通知（期限リマインダー・ポモドーロ終了・Hatch）
            </span>
            {pushState.subscribed ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-emerald-500">この端末で有効</span>
                <button
                  onClick={handleTestNotification}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  テスト送信
                </button>
              </div>
            ) : pushState.permission === 'denied' ? (
              <span className="text-xs text-neutral-400">ブラウザで拒否されています</span>
            ) : (
              <button
                onClick={handleEnableNotifications}
                disabled={pushState.permission === 'unsupported'}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {pushState.permission === 'unsupported' ? '非対応' : '有効にする'}
              </button>
            )}
          </div>
          {pushState.permission === 'denied' && (
            <p className="mt-1 text-xs text-neutral-400">
              一度拒否するとこの画面からは再許可できません。ブラウザのサイト設定から通知を許可してください
            </p>
          )}
          <p className="mt-1 text-xs text-neutral-400">
            通知は端末（ブラウザ）ごとの登録です。PCとスマホ両方で受け取るには、それぞれの端末でこの画面を開いて有効にしてください
          </p>
          {notificationStatus && <p className="mt-1 text-xs text-neutral-400">{notificationStatus}</p>}
        </div>

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          {/* ログイン端末と同様、購読URLが増えると見づらくなるという指摘（改修15回目）を受け、
              折りたたみ可能にした */}
          <CollapsibleSection
            title={`カレンダー購読（ICS）${feeds.length > 0 ? `（${feeds.length}件）` : ''}`}
            action={
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFeedNameInput(true);
                }}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                + URLを作成
              </button>
            }
          >
            {showFeedNameInput && (
              <div className="mt-2 flex gap-1">
                <input
                  autoFocus
                  value={newFeedName}
                  onChange={(e) => setNewFeedName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFeed()}
                  placeholder="名前（任意・例: iPhoneカレンダー）"
                  className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
                />
                <button
                  onClick={handleCreateFeed}
                  className="shrink-0 rounded-md border border-blue-300 px-2 py-1 text-xs text-blue-600 dark:border-blue-700 dark:text-blue-300"
                >
                  作成
                </button>
              </div>
            )}
            {feeds.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {feeds.map((f) => (
                  <li key={f.id} className="flex items-center justify-between text-xs text-neutral-400">
                    <span className="min-w-0 flex-1 truncate">
                      {f.name || `${f.token.slice(0, 16)}…`}
                    </span>
                    <button
                      onClick={() => handleRevokeFeed(f.id)}
                      disabled={revokingFeedIds.has(f.id)}
                      title="このURLを無効化する"
                      className="ml-2 shrink-0 text-red-500 disabled:opacity-40"
                    >
                      {revokingFeedIds.has(f.id) ? '処理中…' : '失効させる'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {calendarStatus && <p className="mt-1 break-all text-xs text-neutral-400">{calendarStatus}</p>}
          </CollapsibleSection>
        </div>

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          {/* 端末が増えると一覧が長くなり見づらいという指摘（改修14回目）を受け、
              折りたたみ可能にした。件数はタイトル横に出して開かなくても把握できるようにする */}
          <CollapsibleSection title={`ログイン中のセッション（${sessions.length}件）`}>
            <ul className="mt-2 flex flex-col gap-1.5">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-xs">
                  <div className="min-w-0 flex-1 truncate text-muted">
                    {s.device_label ?? 'ブラウザ'}
                    {s.is_current && <span className="ml-1 text-emerald-500">（このデバイス）</span>}
                    <div className="text-[10px] text-neutral-400">{formatDateTimeJst(s.created_at)}〜</div>
                  </div>
                  <button
                    onClick={() => handleRevokeSession(s.id)}
                    disabled={revokingSessionIds.has(s.id)}
                    className="ml-2 shrink-0 text-red-500 hover:text-red-600 disabled:opacity-40"
                  >
                    {revokingSessionIds.has(s.id) ? '処理中…' : 'ログアウト'}
                  </button>
                </li>
              ))}
              {sessions.length === 0 && <li className="text-xs text-neutral-400">読み込み中…</li>}
            </ul>
            {sessionStatus && <p className="mt-1 text-xs text-red-500">{sessionStatus}</p>}
          </CollapsibleSection>
        </div>

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">同期の不具合を報告</span>
            <button
              onClick={handleSendLogs}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              ログを送信
            </button>
          </div>
          {logStatus && <p className="mt-1 text-xs text-neutral-400">{logStatus}</p>}
        </div>

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">データのエクスポート/インポート</span>
            <div className="flex gap-1">
              <button
                onClick={handleExport}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                エクスポート
              </button>
              <label className="cursor-pointer rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
                インポート
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImportFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            添付ファイルの実体は含まれません（機種変更時のデータ移行・手元へのバックアップ用）
          </p>
          {exportImportStatus && <p className="mt-1 text-xs text-neutral-400">{exportImportStatus}</p>}
        </div>
      </div>
    </div>
  );
}
