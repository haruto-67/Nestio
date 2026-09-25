import type { ApiKeyRow, ApiKeyScopeRequest } from '@nestio/shared';
import { apiClient } from './client.js';

export function listApiKeys(): Promise<ApiKeyRow[]> {
  return apiClient.get('/api-keys');
}

export function createApiKey(
  name: string,
  scope: ApiKeyScopeRequest,
): Promise<{ id: string; key: string; name: string; scope: string }> {
  return apiClient.post('/api-keys', { name, scope });
}

export function revokeApiKey(id: string): Promise<void> {
  return apiClient.del(`/api-keys/${id}`);
}
