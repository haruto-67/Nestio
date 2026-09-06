import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import {
  inviteToFolder,
  listOutgoingFolderShares,
  listIncomingFolderShares,
  acceptFolderShare,
  revokeFolderShare,
} from './folder-shares.js';
import { ShareError } from './list-shares.js';

function insertFolder(db: Database.Database, userId: string, name = 'フォルダ'): string {
  const id = uuidv7();
  db.prepare(
    `INSERT INTO folders (id, user_id, name, sort_order, created_at, updated_at, deleted_at, seq)
     VALUES (?, ?, ?, 1, ?, ?, NULL, 1)`,
  ).run(id, userId, name, Date.now(), Date.now());
  return id;
}

describe('shares/folder-shares', () => {
  let db: Database.Database;
  let ownerId: string;
  let editorId: string;
  let folderId: string;

  afterEach(() => db?.close());

  function setup() {
    db = createTestDb();
    ownerId = uuidv7();
    editorId = uuidv7();
    insertTestUser(db, ownerId);
    insertTestUser(db, editorId);
    folderId = insertFolder(db, ownerId);
  }

  it('既存ユーザーのメールアドレスへ招待できる', () => {
    setup();
    const share = inviteToFolder(db, ownerId, folderId, `${editorId}@example.com`);
    expect(share.status).toBe('pending');
    expect(share.invited_user_id).toBe(editorId);
  });

  it('自分の所有でないフォルダは共有できない', () => {
    setup();
    expect(() => inviteToFolder(db, editorId, folderId, `${editorId}@example.com`)).toThrow(ShareError);
  });

  it('登録されていないメールアドレスへは招待できない', () => {
    setup();
    expect(() => inviteToFolder(db, ownerId, folderId, 'nobody@example.com')).toThrow(ShareError);
  });

  it('自分自身は招待できない', () => {
    setup();
    expect(() => inviteToFolder(db, ownerId, folderId, `${ownerId}@example.com`)).toThrow(ShareError);
  });

  it('同じフォルダへ重複して招待できない', () => {
    setup();
    inviteToFolder(db, ownerId, folderId, `${editorId}@example.com`);
    expect(() => inviteToFolder(db, ownerId, folderId, `${editorId}@example.com`)).toThrow(ShareError);
  });

  it('承諾は招待された本人のみでき、既存のリスト・タスクも複製される', () => {
    setup();
    const listId = insertTestList(db, ownerId);
    db.prepare('UPDATE lists SET folder_id = ? WHERE id = ?').run(folderId, listId);
    const taskId = insertTestTask(db, ownerId, listId, '既存タスク');

    const share = inviteToFolder(db, ownerId, folderId, `${editorId}@example.com`);
    expect(() => acceptFolderShare(db, ownerId, share.id)).toThrow(ShareError);

    const accepted = acceptFolderShare(db, editorId, share.id);
    expect(accepted.status).toBe('accepted');

    const replicatedFolder = db
      .prepare(`SELECT 1 FROM shared_row_changes WHERE user_id = ? AND table_name = 'folders' AND row_id = ?`)
      .get(editorId, folderId);
    expect(replicatedFolder).toBeTruthy();
    const replicatedList = db
      .prepare(`SELECT 1 FROM shared_row_changes WHERE user_id = ? AND table_name = 'lists' AND row_id = ?`)
      .get(editorId, listId);
    expect(replicatedList).toBeTruthy();
    const replicatedTask = db
      .prepare(`SELECT 1 FROM shared_row_changes WHERE user_id = ? AND table_name = 'tasks' AND row_id = ?`)
      .get(editorId, taskId);
    expect(replicatedTask).toBeTruthy();
  });

  it('解除すると以後は複製対象から外れる', () => {
    setup();
    const share = inviteToFolder(db, ownerId, folderId, `${editorId}@example.com`);
    acceptFolderShare(db, editorId, share.id);
    expect(revokeFolderShare(db, ownerId, share.id)).toBe(true);
  });

  it('招待された側からも解除（離脱）できる', () => {
    setup();
    const share = inviteToFolder(db, ownerId, folderId, `${editorId}@example.com`);
    acceptFolderShare(db, editorId, share.id);
    expect(revokeFolderShare(db, editorId, share.id)).toBe(true);
  });

  it('listOutgoingFolderShares/listIncomingFolderSharesが正しく返る', () => {
    setup();
    inviteToFolder(db, ownerId, folderId, `${editorId}@example.com`);

    expect(listOutgoingFolderShares(db, ownerId)).toHaveLength(1);
    const incoming = listIncomingFolderShares(db, editorId);
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.folder_name).toBe('フォルダ');
    expect(incoming[0]?.owner_email).toBe(`${ownerId}@example.com`);
  });
});
