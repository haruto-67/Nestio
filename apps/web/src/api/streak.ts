import { apiClient } from './client.js';

export interface StreakInfo {
  streak: number;
  total_completions: number;
}

export function getTaskStreak(taskId: string): Promise<StreakInfo> {
  return apiClient.get(`/tasks/${taskId}/streak`);
}
