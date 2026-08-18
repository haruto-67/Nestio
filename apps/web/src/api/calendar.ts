import { apiClient } from './client.js';

export interface CalendarFeed {
  id: string;
  token: string;
  list_id: string | null;
  name: string;
  created_at: number;
  revoked_at: number | null;
}

export function createCalendarFeed(listId?: string, name?: string): Promise<{ token: string; url: string }> {
  return apiClient.post('/calendar/feeds', {
    ...(listId ? { list_id: listId } : {}),
    ...(name ? { name } : {}),
  });
}

export function listCalendarFeeds(): Promise<CalendarFeed[]> {
  return apiClient.get('/calendar/feeds');
}

export function revokeCalendarFeed(id: string): Promise<void> {
  return apiClient.del(`/calendar/feeds/${id}`);
}
