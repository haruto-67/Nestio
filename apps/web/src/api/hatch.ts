import type { HatchActionKey, TriggerRunRow } from '@nestio/shared';
import { apiClient } from './client.js';

export interface HatchActionMetadata {
  key: HatchActionKey;
  params: readonly string[];
}

export function listHatchActions(): Promise<HatchActionMetadata[]> {
  return apiClient.get('/hatch/actions');
}

export function listHatchRuns(triggerId?: string): Promise<TriggerRunRow[]> {
  const query = triggerId ? `?trigger_id=${encodeURIComponent(triggerId)}` : '';
  return apiClient.get(`/hatch/runs${query}`);
}

export function testHatchTrigger(triggerId: string, subjectId?: string): Promise<{ output: string }> {
  return apiClient.post(`/hatch/${triggerId}/test`, subjectId ? { subject_id: subjectId } : {});
}
