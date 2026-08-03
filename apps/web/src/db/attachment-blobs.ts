import { db } from './schema.js';

export async function savePendingAttachmentBlob(sha256: string, blob: Blob): Promise<void> {
  await db.pendingAttachmentBlobs.put({ sha256, blob, createdAt: Date.now() });
}

export async function getPendingAttachmentBlob(sha256: string): Promise<Blob | undefined> {
  const row = await db.pendingAttachmentBlobs.get(sha256);
  return row?.blob;
}

export async function removePendingAttachmentBlob(sha256: string): Promise<void> {
  await db.pendingAttachmentBlobs.delete(sha256);
}
