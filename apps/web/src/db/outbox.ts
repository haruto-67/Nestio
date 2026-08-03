import type { SyncOp } from '@nestio/shared';
import { db, type OutboxEntry } from './schema.js';

export async function appendToOutbox(op: SyncOp): Promise<void> {
  await db.outbox.add({ op, createdAt: Date.now() });
}

export interface MergedOutboxOp {
  op: SyncOp;
  /** このopの元になったoutboxエントリのid群。push完了後にまとめて削除する */
  sourceEntryIds: number[];
}

/**
 * table+idが同じ「連続した」upsertはfieldsをマージし、最後のopのop_idを使う（sync-protocol.md 8章）。
 * 間にdeleteや別行への操作が挟まるとマージ対象から外れる。
 */
function mergeConsecutiveUpserts(entries: OutboxEntry[]): MergedOutboxOp[] {
  const merged: MergedOutboxOp[] = [];

  for (const entry of entries) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.op.op === 'upsert' &&
      entry.op.op === 'upsert' &&
      prev.op.table === entry.op.table &&
      prev.op.id === entry.op.id
    ) {
      prev.op = { ...entry.op, fields: { ...prev.op.fields, ...entry.op.fields } };
      prev.sourceEntryIds.push(entry.id as number);
    } else {
      merged.push({ op: entry.op, sourceEntryIds: [entry.id as number] });
    }
  }

  return merged;
}

/** FIFO順（id昇順=追加順）で最大200件を取得し、マージ済みのop一覧として返す */
export async function drainOutboxBatch(limit = 200): Promise<MergedOutboxOp[]> {
  const entries = await db.outbox.orderBy('id').limit(limit).toArray();
  return mergeConsecutiveUpserts(entries);
}

export async function removeFromOutbox(entryIds: number[]): Promise<void> {
  if (entryIds.length === 0) return;
  await db.outbox.bulkDelete(entryIds);
}

export async function outboxSize(): Promise<number> {
  return db.outbox.count();
}
