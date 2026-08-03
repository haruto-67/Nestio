import { describe, expect, it, beforeEach } from 'vitest';
import { uuidv7, type SyncOp } from '@nestio/shared';
import { db } from './schema.js';
import { appendToOutbox, drainOutboxBatch, removeFromOutbox, outboxSize } from './outbox.js';

function makeOp(id: string, fields: Record<string, unknown>): SyncOp {
  return { op_id: uuidv7(), table: 'tasks', id, op: 'upsert', updated_at: Date.now(), fields };
}

describe('outbox', () => {
  beforeEach(async () => {
    await db.outbox.clear();
  });

  it('FIFO順で取得できる', async () => {
    await appendToOutbox(makeOp('task-1', { title: 'A' }));
    await appendToOutbox(makeOp('task-2', { title: 'B' }));

    const batch = await drainOutboxBatch();
    expect(batch.map((b) => b.op.id)).toEqual(['task-1', 'task-2']);
  });

  it('同一行への連続したupsertはマージされる', async () => {
    const taskId = 'task-1';
    await appendToOutbox(makeOp(taskId, { title: 'A' }));
    await appendToOutbox(makeOp(taskId, { priority: 2 }));

    const batch = await drainOutboxBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0]?.op.fields).toEqual({ title: 'A', priority: 2 });
    expect(batch[0]?.sourceEntryIds).toHaveLength(2);
  });

  it('別の行への操作が間に挟まるとマージされない', async () => {
    await appendToOutbox(makeOp('task-1', { title: 'A' }));
    await appendToOutbox(makeOp('task-2', { title: 'B' }));
    await appendToOutbox(makeOp('task-1', { priority: 2 }));

    const batch = await drainOutboxBatch();
    expect(batch).toHaveLength(3);
  });

  it('removeFromOutboxで指定したエントリのみ削除される', async () => {
    await appendToOutbox(makeOp('task-1', { title: 'A' }));
    await appendToOutbox(makeOp('task-2', { title: 'B' }));

    const batch = await drainOutboxBatch();
    const first = batch[0];
    if (!first) throw new Error('unreachable');
    await removeFromOutbox(first.sourceEntryIds);

    expect(await outboxSize()).toBe(1);
  });
});
