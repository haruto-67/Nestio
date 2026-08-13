import { apiClient } from './client.js';

export interface Me {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  is_admin: boolean;
}

export function fetchMe(): Promise<Me> {
  return apiClient.get<Me>('/auth/me');
}

export function logout(): Promise<void> {
  return apiClient.post<void>('/auth/logout');
}

export function registerDevice(label: string): Promise<{ device_id: string }> {
  return apiClient.post<{ device_id: string }>('/devices', { label });
}

export function googleLoginUrl(): string {
  return '/api/v1/auth/google';
}
