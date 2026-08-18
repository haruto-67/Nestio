import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { AttachmentRow } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { useAttachmentsFor, usePendingAttachmentBlob } from '../../db/queries.js';
import { createAttachment, deleteAttachment, THUMBNAIL_FILENAME_PREFIX } from '../../state/actions.js';
import { processImageFile } from '../../lib/image-processing.js';
import { attachmentUrl } from '../../api/attachments.js';
import { CollapsibleSection } from '../../ui/CollapsibleSection.js';

interface AttachmentListProps {
  ownerType: 'task' | 'note';
  ownerId: string;
}

export function AttachmentList({ ownerType, ownerId }: AttachmentListProps) {
  const { me } = useApp();
  const allAttachments = useAttachmentsFor(ownerType, ownerId);
  // サムネイル行（改修5回目）はUI上は独立した添付として見せない。本体側の表示に内部利用するだけ
  const attachments = allAttachments.filter((a) => !a.filename.startsWith(THUMBNAIL_FILENAME_PREFIX));
  const thumbBySourceFilename = new Map(
    allAttachments
      .filter((a) => a.filename.startsWith(THUMBNAIL_FILENAME_PREFIX))
      .map((a) => [a.filename.slice(THUMBNAIL_FILENAME_PREFIX.length), a]),
  );
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
    <CollapsibleSection
      title="添付画像"
      defaultOpen={attachments.length > 0}
      action={
        <>
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
        </>
      }
    >
      {attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {attachments.map((a) => (
            <AttachmentThumbnail
              key={a.id}
              attachment={a}
              thumbnail={thumbBySourceFilename.get(a.filename)}
              onDelete={() => {
                deleteAttachment(a.id).catch((err) => console.error(err));
              }}
            />
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

function AttachmentThumbnail({
  attachment,
  thumbnail,
  onDelete,
}: {
  attachment: AttachmentRow;
  thumbnail: AttachmentRow | undefined;
  onDelete: () => void;
}) {
  // pushLoopでのアップロードが未完了の間はサーバーへのGETが404になるため、
  // ローカルに残っているBlobがあればそちらをプレビューに使う。表示用には縮小版（あれば）を優先する
  const displaySha256 = thumbnail?.sha256 ?? attachment.sha256;
  const pendingBlob = usePendingAttachmentBlob(displaySha256);
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

  const src = objectUrl ?? attachmentUrl(displaySha256);

  return (
    <div className="group relative">
      <img
        src={src}
        alt={attachment.filename}
        className="h-16 w-full rounded-md bg-neutral-100 object-cover dark:bg-neutral-800"
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
