import type Database from 'better-sqlite3';
import { uuidv7, type ListShareRow } from '@nestio/shared';
import { findUserByEmail } from '../auth/users.js';
import { replicateExistingListToNewEditor } from './replication.js';

export class ShareError extends Error {
  readonly code: 'not_found' | 'forbidden' | 'validation_failed';
  constructor(code: 'not_found' | 'forbidden' | 'validation_failed', message: string) {
    super(message);
    this.code = code;
  }
}

export function findListOwnerId(db: Database.Database, listId: string): string | undefined {
  const row = db.prepare('SELECT user_id FROM lists WHERE id = ? AND deleted_at IS NULL').get(listId) as
    | { user_id: string }
    | undefined;
  return row?.user_id;
}

/** ownerIdがlistIdの所有者であることを確認したうえで、invitedEmailの既存ユーザーへ招待を作る */
export function inviteToList(
  db: Database.Database,
  ownerId: string,
  listId: string,
  invitedEmail: string,
): ListShareRow {
  const listOwnerId = findListOwnerId(db, listId);
  if (!listOwnerId) throw new ShareError('not_found', 'リストが見つかりません');
  if (listOwnerId !== ownerId) throw new ShareError('forbidden', '自分のリストのみ共有できます');

  const invitedUser = findUserByEmail(db, invitedEmail);
  if (!invitedUser) throw new ShareError('not_found', 'そのメールアドレスのユーザーはNestioに登録されていません');
  if (invitedUser.id === ownerId) throw new ShareError('validation_failed', '自分自身は招待できません');

  const existing = db
    .prepare(
      `SELECT id FROM list_shares WHERE list_id = ? AND invited_user_id = ? AND deleted_at IS NULL`,
    )
    .get(listId, invitedUser.id) as { id: string } | undefined;
  if (existing) throw new ShareError('validation_failed', '既に招待済みです');

  const id = uuidv7();
  const now = Date.now();
  db.prepare(
    `INSERT INTO list_shares (id, list_id, owner_user_id, invited_user_id, invited_email, status, created_at, accepted_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL)`,
  ).run(id, listId, ownerId, invitedUser.id, invitedEmail, now);

  return {
    id,
    list_id: listId,
    owner_user_id: ownerId,
    invited_user_id: invitedUser.id,
    invited_email: invitedEmail,
    status: 'pending',
    created_at: now,
    accepted_at: null,
  };
}

/** ownerIdが送った招待の一覧（listIdを指定するとそのリストのみ） */
export function listOutgoingShares(db: Database.Database, ownerId: string, listId?: string): ListShareRow[] {
  const rows = listId
    ? db
        .prepare(
          `SELECT * FROM list_shares WHERE owner_user_id = ? AND list_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
        )
        .all(ownerId, listId)
    : db
        .prepare(`SELECT * FROM list_shares WHERE owner_user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`)
        .all(ownerId);
  return rows as ListShareRow[];
}

/** invitedUserIdが受け取った招待の一覧（pending/accepted両方） */
export function listIncomingShares(db: Database.Database, invitedUserId: string): ListShareRow[] {
  return db
    .prepare(
      `SELECT * FROM list_shares WHERE invited_user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    )
    .all(invitedUserId) as ListShareRow[];
}

/** 招待された本人のみ承諾できる。承諾すると既存タスク・リスト自体がeditorへ複製される */
export function acceptShare(db: Database.Database, invitedUserId: string, shareId: string): ListShareRow {
  const run = db.transaction(() => {
    const existing = db
      .prepare(`SELECT * FROM list_shares WHERE id = ? AND deleted_at IS NULL`)
      .get(shareId) as ListShareRow | undefined;
    if (!existing) throw new ShareError('not_found', '招待が見つかりません');
    if (existing.invited_user_id !== invitedUserId) throw new ShareError('forbidden', '自分宛の招待のみ承諾できます');
    if (existing.status === 'accepted') return existing;

    const acceptedAt = Date.now();
    db.prepare(`UPDATE list_shares SET status = 'accepted', accepted_at = ? WHERE id = ?`).run(acceptedAt, shareId);
    replicateExistingListToNewEditor(db, existing.list_id, invitedUserId);

    return { ...existing, status: 'accepted' as const, accepted_at: acceptedAt };
  });
  return run();
}

/**
 * 共有を解除する。owner（招待した側）とinvitedUser（招待された側の離脱）のどちらからでも呼べる。
 * 物理削除せず論理削除（deleted_at）にする。既に複製済みのshared_row_changes/tasks/listsの
 * 実データは残るが、以後の新しい変更は複製されなくなる（listShareEditorIdsの対象から外れるため）
 */
export function revokeShare(db: Database.Database, callerId: string, shareId: string): boolean {
  const result = db
    .prepare(
      `UPDATE list_shares SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
       AND (owner_user_id = ? OR invited_user_id = ?)`,
    )
    .run(Date.now(), shareId, callerId, callerId);
  return result.changes > 0;
}

/** そのユーザーが編集可能な共有リストのlist_id一覧（accepted のみ） */
export function acceptedSharedListIds(db: Database.Database, invitedUserId: string): string[] {
  const rows = db
    .prepare(
      `SELECT list_id FROM list_shares WHERE invited_user_id = ? AND status = 'accepted' AND deleted_at IS NULL`,
    )
    .all(invitedUserId) as { list_id: string }[];
  return rows.map((r) => r.list_id);
}

/** callerIdがlistIdを編集できるか（owner本人、またはacceptedな共有を持つ）。持つならownerのuser_idを返す */
export function resolveEditableListOwner(db: Database.Database, callerId: string, listId: string): string | null {
  const ownerId = findListOwnerId(db, listId);
  if (!ownerId) return null;
  if (ownerId === callerId) return ownerId;

  const shared = db
    .prepare(
      `SELECT 1 FROM list_shares WHERE list_id = ? AND invited_user_id = ? AND status = 'accepted' AND deleted_at IS NULL`,
    )
    .get(listId, callerId);
  return shared ? ownerId : null;
}
