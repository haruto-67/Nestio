import { pullChanges, pushOps } from '../api/sync.js';
import { applyPullResponse } from '../db/merge.js';
import { drainOutboxBatch, removeFromOutbox } from '../db/outbox.js';
import { getMeta, setMeta, META_KEYS, resetLocalDataKeepingOutbox } from '../db/schema.js';
import { logClientEvent } from './log-buffer.js';

let clockSkewMs = 0;
let deviceId: string | null = null;
let syncing = false;

export function setDeviceId(id: string | null): void {
  deviceId = id;
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
}

/** outboxをFIFOで送信する。ネットワーク失敗時は残りをoutboxに残したまま終了する */
export async function pushLoop(): Promise<void> {
  if (!deviceId) return;

  for (;;) {
    const batch = await drainOutboxBatch(200);
    if (batch.length === 0) return;

    let res;
    try {
      res = await pushOps(deviceId, batch.map((b) => b.op));
    } catch (err) {
      logClientEvent('warn', 'outbox_push_failed', { error: String(err) });
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
    const idsToRemove = batch
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
