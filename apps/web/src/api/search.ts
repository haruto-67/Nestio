import type { SearchResponse } from '@nestio/shared';
import { apiClient } from './client.js';

export function search(q: string, limit = 20): Promise<SearchResponse> {
  return apiClient.get<SearchResponse>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}
