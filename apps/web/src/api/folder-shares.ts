import type { FolderShareRow, IncomingFolderShareView } from '@nestio/shared';
import { apiClient } from './client.js';

export function inviteToFolder(folderId: string, invitedEmail: string): Promise<FolderShareRow> {
  return apiClient.post('/folder-shares', { folder_id: folderId, invited_email: invitedEmail });
}

export function listOutgoingFolderShares(folderId?: string): Promise<FolderShareRow[]> {
  return apiClient.get(folderId ? `/folder-shares/outgoing?folder_id=${folderId}` : '/folder-shares/outgoing');
}

export function listIncomingFolderShares(): Promise<IncomingFolderShareView[]> {
  return apiClient.get('/folder-shares/incoming');
}

export function acceptFolderShare(id: string): Promise<FolderShareRow> {
  return apiClient.post(`/folder-shares/${id}/accept`);
}

export function revokeFolderShare(id: string): Promise<void> {
  return apiClient.del(`/folder-shares/${id}`);
}
