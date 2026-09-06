import type Database from 'better-sqlite3';
import { uuidv7, type FolderShareRow, type IncomingFolderShareView } from '@nestio/shared';
import { findUserByEmail } from '../auth/users.js';
import { ShareError } from './list-shares.js';
import { replicateExistingFolderToNewEditor } from './replication.js';

function findFolderOwnerId(db: Database.Database, folderId: string): string | undefined {
  const row = db.prepare('SELECT user_id FROM folders WHERE id = ? AND deleted_at IS NULL').get(folderId) as
    | { user_id: string }
    | undefined;
  return row?.user_id;
}

/** ownerIdがfolderIdの所有者であることを確認したうえで、invitedEmailの既存ユーザーへ招待を作る */
export function inviteToFolder(
  db: Database.Database,
  ownerId: string,
  folderId: string,
  invitedEmail: string,
): FolderShareRow {
  const folderOwnerId = findFolderOwnerId(db, folderId);
  if (!folderOwnerId) throw new ShareError('not_found', 'フォルダが見つかりません');
  if (folderOwnerId !== ownerId) throw new ShareError('forbidden', '自分のフォルダのみ共有できます');

  const invitedUser = findUserByEmail(db, invitedEmail);
  if (!invitedUser) throw new ShareError('not_found', 'そのメールアドレスのユーザーはNestioに登録されていません');
  if (invitedUser.id === ownerId) throw new ShareError('validation_failed', '自分自身は招待できません');

  const existing = db
    .prepare(`SELECT id FROM folder_shares WHERE folder_id = ? AND invited_user_id = ? AND deleted_at IS NULL`)
    .get(folderId, invitedUser.id) as { id: string } | undefined;
  if (existing) throw new ShareError('validation_failed', '既に招待済みです');

  const id = uuidv7();
  const now = Date.now();
  db.prepare(
    `INSERT INTO folder_shares (id, folder_id, owner_user_id, invited_user_id, invited_email, status, created_at, accepted_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL)`,
  ).run(id, folderId, ownerId, invitedUser.id, invitedEmail, now);

  return {
    id,
    folder_id: folderId,
    owner_user_id: ownerId,
    invited_user_id: invitedUser.id,
    invited_email: invitedEmail,
    status: 'pending',
    created_at: now,
    accepted_at: null,
  };
}

/** ownerIdが送った招待の一覧（folderIdを指定するとそのフォルダのみ） */
export function listOutgoingFolderShares(db: Database.Database, ownerId: string, folderId?: string): FolderShareRow[] {
  const rows = folderId
    ? db
        .prepare(
          `SELECT * FROM folder_shares WHERE owner_user_id = ? AND folder_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
        )
        .all(ownerId, folderId)
    : db
        .prepare(`SELECT * FROM folder_shares WHERE owner_user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`)
        .all(ownerId);
  return rows as FolderShareRow[];
}

/** invitedUserIdが受け取った招待の一覧（pending/accepted両方）。folder_name・owner_emailを付けて返す */
export function listIncomingFolderShares(db: Database.Database, invitedUserId: string): IncomingFolderShareView[] {
  return db
    .prepare(
      `SELECT s.*, f.name AS folder_name, u.email AS owner_email
       FROM folder_shares s
       JOIN folders f ON f.id = s.folder_id
       JOIN users u ON u.id = s.owner_user_id
       WHERE s.invited_user_id = ? AND s.deleted_at IS NULL
       ORDER BY s.created_at DESC`,
    )
    .all(invitedUserId) as IncomingFolderShareView[];
}

/** 招待された本人のみ承諾できる。承諾すると、そのフォルダ自体・配下の全リスト・全タスクがeditorへ複製される */
export function acceptFolderShare(db: Database.Database, invitedUserId: string, shareId: string): FolderShareRow {
  const run = db.transaction(() => {
    const existing = db
      .prepare(`SELECT * FROM folder_shares WHERE id = ? AND deleted_at IS NULL`)
      .get(shareId) as FolderShareRow | undefined;
    if (!existing) throw new ShareError('not_found', '招待が見つかりません');
    if (existing.invited_user_id !== invitedUserId) throw new ShareError('forbidden', '自分宛の招待のみ承諾できます');
    if (existing.status === 'accepted') return existing;

    const acceptedAt = Date.now();
    db.prepare(`UPDATE folder_shares SET status = 'accepted', accepted_at = ? WHERE id = ?`).run(acceptedAt, shareId);
    replicateExistingFolderToNewEditor(db, existing.folder_id, invitedUserId);

    return { ...existing, status: 'accepted' as const, accepted_at: acceptedAt };
  });
  return run();
}

/** owner・招待された側どちらからでも解除できる（list-shares.tsのrevokeShareと対称） */
export function revokeFolderShare(db: Database.Database, callerId: string, shareId: string): boolean {
  const result = db
    .prepare(
      `UPDATE folder_shares SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
       AND (owner_user_id = ? OR invited_user_id = ?)`,
    )
    .run(Date.now(), shareId, callerId, callerId);
  return result.changes > 0;
}
