import { describe, expect, it, beforeEach, vi } from 'vitest';
import { uuidv7 } from '@nestio/shared';
import { db } from '../db/schema.js';

vi.mock('../api/sync.js', () => ({
  pullChanges: vi.fn(),
  pushOps: vi.fn(),
}));

const { attachTaskTag, deleteTaskTag } = await import('./actions.js');

/** attachTaskTag/deleteTaskTag はcommitAndSync経由のfire-and-forgetなので、IndexedDBへの反映を待つ */
async function findTaskTag(taskId: string, tagId: string) {
  return db.task_tags.filter((tt) => tt.task_id === taskId && tt.tag_id === tagId).first();
}

describe('attachTaskTag', () => {
  const userId = 'user-1';

  beforeEach(async () => {
    await db.task_tags.clear();
    await db.outbox.clear();
  });

  it('未付与のタグは新規のtask_tags行を作る', async () => {
    const taskId = uuidv7();
    const tagId = uuidv7();

    await attachTaskTag(userId, taskId, tagId);

    const row = await vi.waitFor(async () => {
      const r = await findTaskTag(taskId, tagId);
      if (!r) throw new Error('not yet persisted');
      return r;
    });
    expect(row.deleted_at).toBeNull();
  });

  it('一度外したタグを付け直すと、新規行を作らず既存行をrestoreする（UNIQUE制約違反の回避）', async () => {
    const taskId = uuidv7();
    const tagId = uuidv7();

    await attachTaskTag(userId, taskId, tagId);
    const firstRow = await vi.waitFor(async () => {
      const r = await findTaskTag(taskId, tagId);
      if (!r) throw new Error('not yet persisted');
      return r;
    });

    deleteTaskTag(firstRow.id);
    await vi.waitFor(async () => {
      const deleted = await db.task_tags.get(firstRow.id);
      if (deleted?.deleted_at == null) throw new Error('not yet deleted');
    });

    await attachTaskTag(userId, taskId, tagId);

    const restored = await vi.waitFor(async () => {
      const r = await findTaskTag(taskId, tagId);
      if (!r || r.deleted_at !== null) throw new Error('not yet restored');
      return r;
    });
    expect(restored.id).toBe(firstRow.id);

    const rows = await db.task_tags.filter((tt) => tt.task_id === taskId && tt.tag_id === tagId).toArray();
    expect(rows).toHaveLength(1);
  });
});
