import { useEffect, useState } from 'react';
import {
  listAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
  type AccessRequest,
} from '../../api/admin.js';
import { formatDateTimeJst } from '../../lib/datetime.js';

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    listAccessRequests('pending')
      .then(setRequests)
      .catch(() => setRequests([]));
  };

  useEffect(refresh, []);

  const handleApprove = async (req: AccessRequest) => {
    setBusyId(req.id);
    try {
      await approveAccessRequest(req.id);
      setStatus(`${req.display_name} を承認しました`);
      refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '承認に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (req: AccessRequest) => {
    setBusyId(req.id);
    try {
      await rejectAccessRequest(req.id);
      setStatus(`${req.display_name} を却下しました`);
      refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '却下に失敗しました');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 nestio-overlay" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[28rem] flex-col rounded-xl bg-white p-4 shadow-lg dark:bg-neutral-900 nestio-modal-panel"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">アカウント申請</h2>
          <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
            閉じる
          </button>
        </div>

        {status && <p className="mb-2 text-xs text-neutral-400">{status}</p>}

        <ul className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {requests.length === 0 && <li className="text-xs text-neutral-400">保留中の申請はありません</li>}
          {requests.map((r) => (
            <li key={r.id} className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-700">
              <div className="font-medium">{r.display_name}</div>
              <div className="text-neutral-400">{r.email}</div>
              <div className="text-neutral-400">{formatDateTimeJst(r.requested_at)}</div>
              <div className="mt-2 flex gap-1">
                <button
                  onClick={() => handleApprove(r)}
                  disabled={busyId === r.id}
                  className="rounded-md px-2 py-1 text-emerald-600 hover:bg-emerald-50 hover:underline disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                >
                  承認
                </button>
                <button
                  onClick={() => handleReject(r)}
                  disabled={busyId === r.id}
                  className="rounded-md px-2 py-1 text-red-500 hover:bg-red-50 hover:underline disabled:opacity-50 dark:hover:bg-red-950/40"
                >
                  却下
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
