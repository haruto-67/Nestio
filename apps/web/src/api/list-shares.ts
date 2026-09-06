import type { ListShareRow, IncomingListShareView } from '@nestio/shared';
import { apiClient } from './client.js';

export function inviteToList(listId: string, invitedEmail: string): Promise<ListShareRow> {
  return apiClient.post('/list-shares', { list_id: listId, invited_email: invitedEmail });
}

export function listOutgoingShares(listId?: string): Promise<ListShareRow[]> {
  return apiClient.get(listId ? `/list-shares/outgoing?list_id=${listId}` : '/list-shares/outgoing');
}

export function listIncomingShares(): Promise<IncomingListShareView[]> {
  return apiClient.get('/list-shares/incoming');
}

export function acceptListShare(id: string): Promise<ListShareRow> {
  return apiClient.post(`/list-shares/${id}/accept`);
}

export function revokeListShare(id: string): Promise<void> {
  return apiClient.del(`/list-shares/${id}`);
}
