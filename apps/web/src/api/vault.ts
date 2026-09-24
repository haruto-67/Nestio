import type { KnowledgeCategory } from '@nestio/shared';
import { apiClient } from './client.js';

/**
 * ナレッジVaultのAPI（改修25回目、docs/vault-spec.md 8章）。ナレッジはVaultのmdファイルが正で
 * /syncの対象外のため、CLAUDE.md「絶対に守ること」2・4の例外としてUIからこのAPIを直接使う
 * （2026-09-24 ユーザー承認）。保存時は必ずversionを渡し、他で更新されていれば409になる。
 */

export interface VaultNoteMeta {
  path: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
}

export interface VaultNote extends VaultNoteMeta {
  body: string;
  /** frontmatterを含むファイル全体（ソース編集用） */
  content: string;
  version: string;
  backlinks: { path: string; title: string }[];
}

export interface VaultTree {
  folders: string[];
  notes: VaultNoteMeta[];
}

export interface VaultSearchHit extends VaultNoteMeta {
  snippet: string;
}

const q = encodeURIComponent;

export const vaultApi = {
  tree: () => apiClient.get<VaultTree>('/vault/tree'),
  note: (path: string) => apiClient.get<VaultNote>(`/vault/note?path=${q(path)}`),
  resolve: (title: string) => apiClient.get<{ path: string | null }>(`/vault/resolve?title=${q(title)}`),
  search: (query: string) => apiClient.get<{ notes: VaultSearchHit[] }>(`/vault/search?q=${q(query)}`),
  create: (path: string, description: string, category: KnowledgeCategory) =>
    apiClient.post<{ path: string; version: string }>('/vault/note', { path, description, category }),
  save: (path: string, content: string, version: string) =>
    apiClient.put<{ path: string; version: string }>('/vault/note', { path, content, version }),
  move: (path: string, to: string, version: string) =>
    apiClient.post<{ path: string; version: string; rewritten: string[] }>('/vault/move', { path, to, version }),
  remove: (path: string, version: string) => apiClient.del<{ trashed_to: string }>('/vault/note', { path, version }),
  attachmentUrl: (fileName: string) => `/api/v1/vault/attachments/${q(fileName)}`,
};
