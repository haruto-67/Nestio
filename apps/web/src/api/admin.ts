import { apiClient } from './client.js';

export interface AccessRequest {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: number;
  decided_at: number | null;
}

export function listAccessRequests(status?: AccessRequest['status']): Promise<AccessRequest[]> {
  const query = status ? `?status=${status}` : '';
  return apiClient.get(`/admin/access-requests${query}`);
}

export function approveAccessRequest(id: string): Promise<{ user_id: string }> {
  return apiClient.post(`/admin/access-requests/${id}/approve`, {});
}

export function rejectAccessRequest(id: string): Promise<void> {
  return apiClient.post(`/admin/access-requests/${id}/reject`, {});
}
