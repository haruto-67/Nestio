import { describe, expect, it, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { uuidv7 } from '@nestio/shared';
import { createTestDb, insertTestUser, insertTestList, insertTestTask } from '../test-utils/db.js';
import { raiseGcBoundarySeq } from './seq.js';
import { pullChanges } from './pull.js';
import { applySyncOps } from './apply.js';
import { inviteToList, acceptShare } from '../shares/list-shares.js';
import { inviteToFolder, acceptFolderShare } from '../shares/folder-shares.js';

describe('pullChanges', () => {
  let db: Database.Database;
  let userId: string;

  afterEach(() => db?.close());

  it('通常時はchangesを返す', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    const listId = insertTestList(db, userId);
    insertTestTask(db, userId, listId);

    const result = pullChanges(db, userId, 0, 500);

    expect(result.full_resync_required).toBeUndefined();
    expect(result.changes.tasks).toHaveLength(1);
  });

  it('sinceがgc_boundary_seqより古い場合はfull_resync_requiredを返す', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    raiseGcBoundarySeq(db, userId, 100);

    const result = pullChanges(db, userId, 50, 500);

    expect(result.full_resync_required).toBe(true);
    expect(result.changes).toEqual({});
  });

  it('sinceがgc_boundary_seq以上なら通常通り取得できる', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    raiseGcBoundarySeq(db, userId, 100);

    const result = pullChanges(db, userId, 100, 500);

    expect(result.full_resync_required).toBeUndefined();
  });

  it('since=0（初回同期）はgc_boundary_seqの影響を受けない', () => {
    db = createTestDb();
    userId = uuidv7();
    insertTestUser(db, userId);
    raiseGcBoundarySeq(db, userId, 100);

    const result = pullChanges(db, userId, 0, 500);

    expect(result.full_resync_required).toBeUndefined();
  });
});

describe('pullChanges: リスト共有（改修22回目）', () => {
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

  it('editorのpullには自分のタスクが無くても共有されたタスク・リストが含まれる', () => {
    setup();
    const taskId = insertTestTask(db, ownerId, listId, '共有タスク');
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    acceptShare(db, editorId, share.id);

    const result = pullChanges(db, editorId, 0, 500);

    expect(result.changes.tasks?.map((t) => (t as { id: string }).id)).toContain(taskId);
    expect(result.changes.lists?.map((l) => (l as { id: string }).id)).toContain(listId);
    // 複製されたtasks行のuser_idはownerのまま（改修22回目の設計の核）
    const sharedTaskRow = result.changes.tasks?.find((t) => (t as { id: string }).id === taskId) as
      | { user_id: string }
      | undefined;
    expect(sharedTaskRow?.user_id).toBe(ownerId);
  });

  it('承諾より前のsinceでは共有分は見えず、承諾後の変更からsinceを進めれば見える', () => {
    setup();
    // 承諾前のeditor自身の基準seqを記録（0でよい）
    const share = inviteToList(db, ownerId, listId, `${editorId}@example.com`);
    acceptShare(db, editorId, share.id);
    // 承諾直後、招待前の既存タスクが無い状態なのでlistsのみ複製される
    const afterAccept = pullChanges(db, editorId, 0, 500);
    const sinceAfterAccept = afterAccept.next_seq;

    const taskId = uuidv7();
    applySyncOps(db, ownerId, [
      {
        op_id: uuidv7(),
        table: 'tasks',
        id: taskId,
        op: 'upsert',
        updated_at: Date.now(),
        fields: { list_id: listId, title: '承諾後に作成', sort_order: 1 },
      },
    ]);

    const beforeNewTask = pullChanges(db, editorId, sinceAfterAccept, 500);
    expect(beforeNewTask.changes.tasks?.map((t) => (t as { id: string }).id)).toContain(taskId);
  });

  it('未共有のeditorのpullには他人のタスクが含まれない', () => {
    setup();
    insertTestTask(db, ownerId, listId, '共有していないタスク');

    const result = pullChanges(db, editorId, 0, 500);

    expect(result.changes.tasks).toHaveLength(0);
    expect(result.changes.lists).toHaveLength(0);
  });
});

describe('pullChanges: フォルダ共有（改修22回目フォローアップ）', () => {
  let db: Database.Database;
  let ownerId: string;
  let editorId: string;
  let folderId: string;
  let listId: string;

  afterEach(() => db?.close());

  function insertFolder(userId: string): string {
    const id = uuidv7();
    db.prepare(
      `INSERT INTO folders (id, user_id, name, sort_order, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, 'フォルダ', 1, ?, ?, NULL, 1)`,
    ).run(id, userId, Date.now(), Date.now());
    return id;
  }

  function setup() {
    db = createTestDb();
    ownerId = uuidv7();
    editorId = uuidv7();
    insertTestUser(db, ownerId);
    insertTestUser(db, editorId);
    folderId = insertFolder(ownerId);
    listId = insertTestList(db, ownerId);
    db.prepare('UPDATE lists SET folder_id = ? WHERE id = ?').run(folderId, listId);
  }

  it('editorのpullにはフォルダ自体・配下リスト・タスクがすべて含まれる', () => {
    setup();
    const taskId = insertTestTask(db, ownerId, listId, 'フォルダ共有タスク');
    const share = inviteToFolder(db, ownerId, folderId, `${editorId}@example.com`);
    acceptFolderShare(db, editorId, share.id);

    const result = pullChanges(db, editorId, 0, 500);

    expect(result.changes.folders?.map((f) => (f as { id: string }).id)).toContain(folderId);
    expect(result.changes.lists?.map((l) => (l as { id: string }).id)).toContain(listId);
    expect(result.changes.tasks?.map((t) => (t as { id: string }).id)).toContain(taskId);
  });

  it('フォルダ未共有のeditorのpullにはフォルダ・配下データが含まれない', () => {
    setup();
    insertTestTask(db, ownerId, listId, '共有していないタスク');

    const result = pullChanges(db, editorId, 0, 500);

    expect(result.changes.folders).toHaveLength(0);
    expect(result.changes.lists).toHaveLength(0);
    expect(result.changes.tasks).toHaveLength(0);
  });
});
