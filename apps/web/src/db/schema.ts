import Dexie, { type Table } from 'dexie';
import type {
  FolderRow,
  ListRow,
  TaskRow,
  TagRow,
  TaskTagRow,
  NoteRow,
  AttachmentRow,
  TriggerRow,
  UserSettingsRow,
  SyncOp,
} from '@nestio/shared';

export interface OutboxEntry {
  /** Dexieのauto-increment主キー。送信順(FIFO)の並びに使う */
  id?: number;
  op: SyncOp;
  createdAt: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/**
 * アップロード前の画像Blobを一時的に保持する（要件定義3.6：オフライン時のBlob保持）。
 * sha256をキーにしているのはcontent-addressedな添付の設計と対応させるため。
 * アップロード成功後に削除する（sync/engine.ts の pushLoop 参照）。
 */
export interface PendingAttachmentBlob {
  sha256: string;
  blob: Blob;
  createdAt: number;
}

/**
 * IndexedDB スキーマ。CLAUDE.md 絶対原則4「UIはIndexedDBだけを読む」の実体。
 * サーバーの schema.sql と同じテーブル構成 + outbox（未送信キュー）+ meta（同期カーソル等のKVS）。
 * 論理削除された行も tombstone としてそのまま保持し、読み取り側で deleted_at を見て除外する
 * （sync-protocol.md の tombstone 方式に合わせるため、mergeでは削除しない）。
 */
export class NestioDb extends Dexie {
  folders!: Table<FolderRow, string>;
  lists!: Table<ListRow, string>;
  tasks!: Table<TaskRow, string>;
  tags!: Table<TagRow, string>;
  task_tags!: Table<TaskTagRow, string>;
  notes!: Table<NoteRow, string>;
  attachments!: Table<AttachmentRow, string>;
  triggers!: Table<TriggerRow, string>;
  user_settings!: Table<UserSettingsRow, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;
  pendingAttachmentBlobs!: Table<PendingAttachmentBlob, string>;

  constructor(name = 'nestio') {
    super(name);
    this.version(1).stores({
      folders: 'id, sort_order, deleted_at',
      lists: 'id, folder_id, sort_order, deleted_at',
      tasks: 'id, list_id, parent_id, due_at, due_date, completed_at, sort_order, deleted_at',
      tags: 'id, name, deleted_at',
      task_tags: 'id, task_id, tag_id, deleted_at',
      notes: 'id, pinned, sort_order, deleted_at',
      attachments: 'id, owner_type, owner_id, deleted_at',
      triggers: 'id, event, deleted_at',
      user_settings: 'user_id',
      outbox: '++id, createdAt',
      meta: 'key',
      pendingAttachmentBlobs: 'sha256, createdAt',
    });
  }
}

export const db = new NestioDb();

export const META_KEYS = {
  since: 'since',
  clockSkewMs: 'clock_skew_ms',
  deviceId: 'device_id',
} as const;

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** full_resync_required 時にローカルDBを破棄する。outboxは残す（未送信分を失わないため） */
export async function resetLocalDataKeepingOutbox(): Promise<void> {
  await db.transaction(
    'rw',
    [db.folders, db.lists, db.tasks, db.tags, db.task_tags, db.notes, db.attachments, db.triggers, db.user_settings, db.meta],
    async () => {
      await Promise.all([
        db.folders.clear(),
        db.lists.clear(),
        db.tasks.clear(),
        db.tags.clear(),
        db.task_tags.clear(),
        db.notes.clear(),
        db.attachments.clear(),
        db.triggers.clear(),
        db.user_settings.clear(),
      ]);
      await setMeta(META_KEYS.since, 0);
    },
  );
}
