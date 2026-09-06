import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import {
  inviteToList,
  listOutgoingShares,
  listIncomingShares,
  acceptShare,
  revokeShare,
  resolveEditableListOwner,
  findListOwnerId,
  ShareError,
} from './list-shares.js';

describe('shares/list-shares', () => {
  let db: Database.Database;
  let ownerId: string;
  let editorId: string;
  let listId: string;

  afterEach(() => db?.close());

  function setup() {
    db = createTestDb();
    ownerId = uuidv7();
    editorId = uuidv7();
    insertTestUser(db, ownerId);
    insertTestUser(db, editorId);
    listId = insertTestList(db, ownerId);
  }

  it('既存ユーザーのメールアドレスへ招待できる', () => {
    setup();
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    expect(share.status).toBe('pending');
    expect(share.invited_user_id).toBe(editorId);
  });

  it('自分の所有でないリストは共有できない', () => {
    setup();
    const otherOwnerId = uuidv7();
    insertTestUser(db, otherOwnerId);
    expect(() => inviteToList(db, editorId, listId, `${otherOwnerId}@example.com`)).toThrow(ShareError);
  });

  it('登録されていないメールアドレスへは招待できない', () => {
    setup();
    expect(() => inviteToList(db, ownerId, listId, 'nobody@example.com')).toThrow(ShareError);
  });

  it('自分自身は招待できない', () => {
    setup();
    expect(() => inviteToList(db, ownerId, listId, `${ownerId}@example.com`)).toThrow(ShareError);
  });

  it('同じリストへ重複して招待できない（deleted_atが無い間）', () => {
    setup();
    inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    expect(() => inviteToList(db, ownerId, listId, `${editorId}@example.com`)).toThrow(ShareError);
  });

  it('承諾は招待された本人のみでき、resolveEditableListOwnerがownerを返すようになる', () => {
    setup();
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    expect(resolveEditableListOwner(db, editorId, listId)).toBeNull();

    expect(() => acceptShare(db, ownerId, share.id)).toThrow(ShareError);

    const accepted = acceptShare(db, editorId, share.id);
    expect(accepted.status).toBe('accepted');
    expect(resolveEditableListOwner(db, editorId, listId)).toBe(ownerId);
  });

  it('承諾すると招待前からの既存タスクもshared_row_changesに複製される', () => {
    setup();
    const taskId = insertTestTask(db, ownerId, listId, '既存タスク');
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    acceptShare(db, editorId, share.id);

    const row = db
      .prepare(`SELECT 1 FROM shared_row_changes WHERE user_id = ? AND table_name = 'tasks' AND row_id = ?`)
      .get(editorId, taskId);
    expect(row).toBeTruthy();
  });

  it('解除すると編集権限が無くなる', () => {
    setup();
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    acceptShare(db, editorId, share.id);
    expect(revokeShare(db, ownerId, share.id)).toBe(true);
    expect(resolveEditableListOwner(db, editorId, listId)).toBeNull();
  });

  it('招待された側からも解除（離脱）できる', () => {
    setup();
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    acceptShare(db, editorId, share.id);
    expect(revokeShare(db, editorId, share.id)).toBe(true);
  });

  it('無関係な第三者は解除できない', () => {
    setup();
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    const strangerId = uuidv7();
    insertTestUser(db, strangerId);
    expect(revokeShare(db, strangerId, share.id)).toBe(false);
  });

  it('listOutgoingShares/listIncomingSharesが正しく返る', () => {
    setup();
    inviteToList(db, ownerId, listId, `${editorId}@example.com`);

    expect(listOutgoingShares(db, ownerId)).toHaveLength(1);
    expect(listOutgoingShares(db, editorId)).toHaveLength(0);
    expect(listIncomingShares(db, editorId)).toHaveLength(1);
    expect(listIncomingShares(db, ownerId)).toHaveLength(0);
  });

  it('findListOwnerIdはlistsのuser_idを返す', () => {
    setup();
    expect(findListOwnerId(db, listId)).toBe(ownerId);
    expect(findListOwnerId(db, uuidv7())).toBeUndefined();
  });
});
