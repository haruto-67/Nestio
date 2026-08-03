import { useLiveQuery } from 'dexie-react-hooks';
import type {
  FolderRow,
  ListRow,
  TaskRow,
  TagRow,
  TaskTagRow,
  UserSettingsRow,
  NoteRow,
  AttachmentRow,
} from '@nestio/shared';
import { db } from './schema.js';

export function useFolders(): FolderRow[] {
  return useLiveQuery(() => db.folders.filter((f) => f.deleted_at === null).toArray(), [], []) ?? [];
}

export function useLists(): ListRow[] {
  return useLiveQuery(() => db.lists.filter((l) => l.deleted_at === null).toArray(), [], []) ?? [];
}

export function useTasks(): TaskRow[] {
  return useLiveQuery(() => db.tasks.filter((t) => t.deleted_at === null).toArray(), [], []) ?? [];
}

export function useTask(id: string | null): TaskRow | undefined {
  return useLiveQuery(() => (id ? db.tasks.get(id) : undefined), [id], undefined);
}

export function useTags(): TagRow[] {
  return useLiveQuery(() => db.tags.filter((t) => t.deleted_at === null).toArray(), [], []) ?? [];
}

export function useTaskTags(): TaskTagRow[] {
  return useLiveQuery(() => db.task_tags.filter((t) => t.deleted_at === null).toArray(), [], []) ?? [];
}

export function useUserSettings(): UserSettingsRow | undefined {
  return useLiveQuery(() => db.user_settings.toCollection().first(), [], undefined);
}

export function useNotes(): NoteRow[] {
  return useLiveQuery(() => db.notes.filter((n) => n.deleted_at === null).toArray(), [], []) ?? [];
}

export function useNote(id: string | null): NoteRow | undefined {
  return useLiveQuery(() => (id ? db.notes.get(id) : undefined), [id], undefined);
}

export function useAttachmentsFor(ownerType: 'task' | 'note', ownerId: string | null): AttachmentRow[] {
  return (
    useLiveQuery(
      () =>
        ownerId
          ? db.attachments
              .filter((a) => a.owner_type === ownerType && a.owner_id === ownerId && a.deleted_at === null)
              .toArray()
          : [],
      [ownerType, ownerId],
      [],
    ) ?? []
  );
}
