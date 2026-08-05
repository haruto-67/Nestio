import { pullChanges, pushOps } from '../api/sync.js';
import { uploadAttachmentBlob } from '../api/attachments.js';
import { applyPullResponse } from '../db/merge.js';
import { drainOutboxBatch, removeFromOutbox, type MergedOutboxOp } from '../db/outbox.js';
import { getMeta, setMeta, META_KEYS, resetLocalDataKeepingOutbox } from '../db/schema.js';
import { getPendingAttachmentBlob, removePendingAttachmentBlob } from '../db/attachment-blobs.js';
import { logClientEvent } from './log-buffer.js';

let clockSkewMs = 0;
let deviceId: string | null = null;
let syncing = false;

export function setDeviceId(id: string | null): void {
  deviceId = id;
}

// 同期状態の可視化用（改修5回目）。UIの「最終同期:N分前」表示のために公開する
const SYNC_STATUS_EVENT = 'nestio:sync-status-changed';
export interface SyncStatus {
  lastSyncAt: number | null;
  lastError: boolean;
}
let syncStatus: SyncStatus = { lastSyncAt: null, lastError: false };

function setSyncStatus(patch: Partial<SyncStatus>): void {
  syncStatus = { ...syncStatus, ...patch };
  // vitestのnode環境（windowが無い）から呼ばれるsync engineの単体テストでも安全に動くようにする
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT));
}

export function getSyncStatus(): SyncStatus {
  return syncStatus;
}

export function subscribeSyncStatus(onChange: () => void): () => void {
  window.addEventListener(SYNC_STATUS_EVENT, onChange);
  return () => window.removeEventListener(SYNC_STATUS_EVENT, onChange);
}

/** サーバーとの時計ずれを補正したupdated_atを作る（sync-protocol.md 4章） */
export function nowWithSkew(): number {
  return Date.now() + clockSkewMs;
}

/**
 * has_more をページングしながらpullし続ける。
 * full_resync_required が返ったらローカルDBを破棄し（outboxは残す）、since=0からやり直す。
 */
export async function pullLoop(): Promise<void> {
  let since = await getMeta<number>(META_KEYS.since, 0);

  try {
    for (;;) {
      const res = await pullChanges(since);

      if (res.full_resync_required) {
        logClientEvent('warn', 'full_resync_required', { since });
        await resetLocalDataKeepingOutbox();
        since = 0;
        continue;
      }

      await applyPullResponse(res);
      since = res.next_seq;
      await setMeta(META_KEYS.since, since);

      if (!res.has_more) break;
    }
    setSyncStatus({ lastSyncAt: Date.now(), lastError: false });
  } catch (err) {
    setSyncStatus({ lastError: true });
    throw err;
  }
}

/**
 * 保留Blobがあれば先にアップロードする。成功/不要ならtrue、失敗ならfalseを返す。
 * 順序が逆になるとメタデータだけあって実体がない状態が発生するため（sync-protocol.md 9章）、
 * アップロードが済んでいない添付opはこのバッチの送信対象から外し、次回のpushLoopで再試行する。
 */
async function ensureAttachmentUploaded(sha256: string): Promise<boolean> {
  const blob = await getPendingAttachmentBlob(sha256);
  if (!blob) return true; // 保留Blobが無い＝既にアップロード済み（他デバイスからの変更等）

  try {
    await uploadAttachmentBlob(sha256, blob);
    await removePendingAttachmentBlob(sha256);
    return true;
  } catch (err) {
    logClientEvent('warn', 'attachment_upload_failed', { sha256, error: String(err) });
    return false;
  }
}

async function filterAttachmentReady(batch: MergedOutboxOp[]): Promise<MergedOutboxOp[]> {
  const ready: MergedOutboxOp[] = [];
  for (const entry of batch) {
    if (entry.op.table === 'attachments' && entry.op.op === 'upsert') {
      const sha256 = entry.op.fields.sha256;
      if (typeof sha256 === 'string' && !(await ensureAttachmentUploaded(sha256))) {
        continue;
      }
    }
    ready.push(entry);
  }
  return ready;
}

/** outboxをFIFOで送信する。ネットワーク失敗時は残りをoutboxに残したまま終了する */
export async function pushLoop(): Promise<void> {
  if (!deviceId) return;

  for (;;) {
    const batch = await drainOutboxBatch(200);
    if (batch.length === 0) return;

    const readyBatch = await filterAttachmentReady(batch);
    if (readyBatch.length === 0) return; // 全件が添付アップロード待ち

    let res;
    try {
      res = await pushOps(deviceId, readyBatch.map((b) => b.op));
    } catch (err) {
      logClientEvent('warn', 'outbox_push_failed', { error: String(err) });
      setSyncStatus({ lastError: true });
      return;
    }

    if (res.clock_skew_ms !== undefined) {
      clockSkewMs = res.clock_skew_ms;
      logClientEvent('warn', 'clock_skew_detected', { clock_skew_ms: res.clock_skew_ms });
    }
    if (res.rejected.length > 0) {
      logClientEvent('warn', 'ops_rejected', { rejected: res.rejected });
    }

    // applied/rejected問わず応答が返ってきたopはoutboxから消す（rejectedはpullで正しい状態を取り直す）
    const respondedOpIds = new Set([...res.applied, ...res.rejected.map((r) => r.op_id)]);
    const idsToRemove = readyBatch
      .filter((b) => respondedOpIds.has(b.op.op_id))
      .flatMap((b) => b.sourceEntryIds);
    await removeFromOutbox(idsToRemove);

    if (batch.length < 200) return;
  }
}

/** オンライン復帰時の順序：push → pull（逆にするとローカルの未送信変更がサーバー値で潰される） */
export async function syncNow(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    await pushLoop();
    await pullLoop();
  } finally {
    syncing = false;
  }
}
