import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { AttachmentRow } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { useAttachmentsFor, usePendingAttachmentBlob } from '../../db/queries.js';
import { createAttachment, deleteAttachment } from '../../state/actions.js';
import { processImageFile } from '../../lib/image-processing.js';
import { attachmentUrl } from '../../api/attachments.js';

interface AttachmentListProps {
  ownerType: 'task' | 'note';
  ownerId: string;
}

export function AttachmentList({ ownerType, ownerId }: AttachmentListProps) {
  const { me } = useApp();
  const attachments = useAttachmentsFor(ownerType, ownerId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !me) return;
    setProcessing(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const processed = await processImageFile(file);
        await createAttachment(me.id, ownerType, ownerId, processed, file.name);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-1.5 text-xs text-neutral-500">
      <div className="flex items-center justify-between">
        <span>添付画像</span>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-0.5 text-blue-500"
          disabled={processing}
        >
          {processing ? (
            '処理中…'
          ) : (
            <>
              <Plus size={12} />
              追加
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            handleFiles(e.target.files).catch((err) => console.error(err));
          }}
        />
      </div>

      {attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {attachments.map((a) => (
            <AttachmentThumbnail key={a.id} attachment={a} onDelete={() => deleteAttachment(a.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentThumbnail({ attachment, onDelete }: { attachment: AttachmentRow; onDelete: () => void }) {
  // pushLoopでのアップロードが未完了の間はサーバーへのGETが404になるため、
  // ローカルに残っているBlobがあればそちらをプレビューに使う
  const pendingBlob = usePendingAttachmentBlob(attachment.sha256);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingBlob) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingBlob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingBlob]);

  const src = objectUrl ?? attachmentUrl(attachment.sha256);

  return (
    <div className="group relative">
      <img
        src={src}
        alt={attachment.filename}
        className="h-16 w-full rounded bg-neutral-100 object-cover dark:bg-neutral-800"
        onError={(e) => {
          e.currentTarget.style.opacity = '0.3';
        }}
      />
      <button
        onClick={onDelete}
        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
      >
        <X size={11} />
      </button>
    </div>
  );
}
