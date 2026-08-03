import type { FolderRow, ListRow, TaskRow, TagRow, TaskTagRow, UserSettingsRow } from '@nestio/shared';

export interface AppData {
  since: number;
  folders: Map<string, FolderRow>;
  lists: Map<string, ListRow>;
  tasks: Map<string, TaskRow>;
  tags: Map<string, TagRow>;
  taskTags: Map<string, TaskTagRow>;
  userSettings: UserSettingsRow | null;
}

export function createEmptyAppData(): AppData {
  return {
    since: 0,
    folders: new Map(),
    lists: new Map(),
    tasks: new Map(),
    tags: new Map(),
    taskTags: new Map(),
    userSettings: null,
  };
}
