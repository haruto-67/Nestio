import { describe, expect, it, beforeEach, vi } from 'vitest';
import { uuidv7, type SyncPullResponse, type SyncPushResponse } from '@nestio/shared';
import { db, getMeta, META_KEYS } from '../db/schema.js';
import { appendToOutbox } from '../db/outbox.js';

vi.mock('../api/sync.js', () => ({
  pullChanges: vi.fn(),
  pushOps: vi.fn(),
}));

const { pullChanges, pushOps } = await import('../api/sync.js');
const { pullLoop, pushLoop, setDeviceId } = await import('./engine.js');

function emptyPullResponse(nextSeq: number, hasMore = false): SyncPullResponse {
  return {
    changes: {
      folders: [],
      lists: [],
      tasks: [],
      tags: [],
      task_tags: [],
      notes: [],
      attachments: [],
      triggers: [],
      user_settings: [],
    },
    next_seq: nextSeq,
    has_more: hasMore,
  };
}

describe('sync engine', () => {
  beforeEach(async () => {
    vi.mocked(pullChanges).mockReset();
    vi.mocked(pushOps).mockReset();
    await db.outbox.clear();
    await db.tasks.clear();
    await db.meta.clear();
    setDeviceId('device-a');
  });

  describe('pullLoop', () => {
    it('has_moreをページングしてsinceを更新する', async () => {
      vi.mocked(pullChanges)
        .mockResolvedValueOnce(emptyPullResponse(100, true))
        .mockResolvedValueOnce(emptyPullResponse(200, false));

      await pullLoop();

      expect(pullChanges).toHaveBeenCalledTimes(2);
      expect(pullChanges).toHaveBeenNthCalledWith(1, 0);
      expect(pullChanges).toHaveBeenNthCalledWith(2, 100);
      expect(await getMeta(META_KEYS.since, -1)).toBe(200);
    });

    it('full_resync_requiredが返るとローカルタスクを破棄してsince=0からやり直す', async () => {
      await db.tasks.put({
        id: 'stale-task',
        user_id: 'u1',
        list_id: 'l1',
        parent_id: null,
        title: '古いタスク',
        note: '',
        priority: 0,
        due_at: null,
        due_date: null,
        rrule: null,
        completed_at: null,
        sort_order: 1,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
        seq: 5,
      });

      vi.mocked(pullChanges)
        .mockResolvedValueOnce({ ...emptyPullResponse(0), full_resync_required: true })
        .mockResolvedValueOnce(emptyPullResponse(50, false));

      await pullLoop();

      expect(await db.tasks.get('stale-task')).toBeUndefined();
      expect(await getMeta(META_KEYS.since, -1)).toBe(50);
    });
  });

  describe('pushLoop', () => {
    it('成功したopをoutboxから削除する', async () => {
      const op = { op_id: uuidv7(), table: 'tasks' as const, id: 't1', op: 'upsert' as const, updated_at: 1, fields: {} };
      await appendToOutbox(op);

      const response: SyncPushResponse = { applied: [op.op_id], rejected: [], next_seq: 10 };
      vi.mocked(pushOps).mockResolvedValueOnce(response);

      await pushLoop();

      expect(await db.outbox.count()).toBe(0);
    });

    it('rejectされたopもoutboxから削除する（pullで正しい状態を取り直すため）', async () => {
      const op = { op_id: uuidv7(), table: 'tasks' as const, id: 't1', op: 'upsert' as const, updated_at: 1, fields: {} };
      await appendToOutbox(op);

      const response: SyncPushResponse = {
        applied: [],
        rejected: [{ op_id: op.op_id, reason: 'cycle_detected' }],
        next_seq: 10,
      };
      vi.mocked(pushOps).mockResolvedValueOnce(response);

      await pushLoop();

      expect(await db.outbox.count()).toBe(0);
    });

    it('ネットワーク失敗時はoutboxに残す', async () => {
      const op = { op_id: uuidv7(), table: 'tasks' as const, id: 't1', op: 'upsert' as const, updated_at: 1, fields: {} };
      await appendToOutbox(op);

      vi.mocked(pushOps).mockRejectedValueOnce(new Error('network error'));

      await pushLoop();

      expect(await db.outbox.count()).toBe(1);
    });

    it('deviceId未設定時は何もしない', async () => {
      setDeviceId(null);
      const op = { op_id: uuidv7(), table: 'tasks' as const, id: 't1', op: 'upsert' as const, updated_at: 1, fields: {} };
      await appendToOutbox(op);

      await pushLoop();

      expect(pushOps).not.toHaveBeenCalled();
      expect(await db.outbox.count()).toBe(1);
    });
  });
});
