import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { ListShareRow } from '@nestio/shared';
import { inviteToList, listOutgoingShares, revokeListShare } from '../../api/list-shares.js';
import { ApiRequestError } from '../../api/client.js';

interface ListShareModalProps {
  listId: string;
  listName: string;
  onClose: () => void;
}

/**
 * リスト単位の共有管理（改修22回目）。既存ユーザーのメールアドレスを指定して招待し、
 * 送信済みの招待（pending/accepted）を一覧・解除できる。閲覧専用ロールは無く、
 * 承諾した相手は常に編集権限を持つ（docs/sync-protocol.md 10章）
 */
export function ListShareModal({ listId, listName, onClose }: ListShareModalProps) {
  const [shares, setShares] = useState<ListShareRow[]>([]);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    listOutgoingShares(listId).then(setShares).catch(() => {});
  }, [listId]);

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus('招待中…');
    try {
      await inviteToList(listId, trimmed);
      setEmail('');
      setStatus(null);
      setShares(await listOutgoingShares(listId));
    } catch (err) {
      setStatus(
        err instanceof ApiRequestError
          ? err.message
          : '招待に失敗しました',
      );
    }
  };

  const handleRevoke = async (id: string) => {
    if (revokingIds.has(id)) return;
    setRevokingIds((prev) => new Set(prev).add(id));
    try {
      await revokeListShare(id);
      setShares((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error(err);
      setStatus('解除に失敗しました');
    } finally {
      setRevokingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-96 flex-col rounded-xl bg-surface p-4 shadow-lg nestio-modal-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="truncate text-sm font-semibold">「{listName}」を共有</h2>
          <button
            onClick={onClose}
            className="flex min-h-8 min-w-8 shrink-0 items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-2 text-xs text-neutral-400">
          Nestioに登録済みのユーザーのメールアドレスを招待すると、このリスト内のタスクを一緒に編集できるようになります
        </p>

        <div className="flex gap-1">
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
            placeholder="相手のメールアドレス"
            className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-xs dark:border-neutral-700"
          />
          <button
            onClick={handleInvite}
            className="shrink-0 rounded-md border border-blue-300 px-2 py-1 text-xs text-blue-600 dark:border-blue-700 dark:text-blue-300"
          >
            招待
          </button>
        </div>
        {status && <p className="mt-1 text-xs text-red-500">{status}</p>}

        <div className="mt-3 flex-1 overflow-y-auto border-t border-neutral-200 pt-2 dark:border-neutral-800">
          {shares.length === 0 ? (
            <p className="text-xs text-neutral-400">まだ誰も招待していません</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shares.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-xs">
                  <div className="min-w-0 flex-1 truncate text-muted">
                    {s.invited_email}
                    <span
                      className={`ml-1.5 ${s.status === 'accepted' ? 'text-emerald-500' : 'text-neutral-400'}`}
                    >
                      {s.status === 'accepted' ? '参加中' : '招待中'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRevoke(s.id)}
                    disabled={revokingIds.has(s.id)}
                    className="ml-2 shrink-0 text-red-500 hover:text-red-600 disabled:opacity-40"
                  >
                    {revokingIds.has(s.id) ? '処理中…' : '解除'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
