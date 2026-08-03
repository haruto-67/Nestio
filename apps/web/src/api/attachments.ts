export async function uploadAttachmentBlob(sha256: string, blob: Blob): Promise<void> {
  const res = await fetch(`/api/v1/attachments/${sha256}`, {
    method: 'POST',
    credentials: 'include',
    body: blob,
  });
  if (!res.ok) throw new Error(`添付のアップロードに失敗しました: ${res.status}`);
}

export function attachmentUrl(sha256: string): string {
  return `/api/v1/attachments/${sha256}`;
}
