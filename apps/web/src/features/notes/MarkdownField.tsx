import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, Italic } from 'lucide-react';
import { usePendingAttachmentBlob } from '../../db/queries.js';
import { attachmentUrl } from '../../api/attachments.js';
import { createAttachment } from '../../state/actions.js';
import { processImageFile } from '../../lib/image-processing.js';

const SHA256_PREFIX = 'sha256:';

function MarkdownImage({ alt, src }: { alt: string; src: string }) {
  const isEmbedded = src.startsWith(SHA256_PREFIX);
  const sha256 = isEmbedded ? src.slice(SHA256_PREFIX.length) : '';
  const pendingBlob = usePendingAttachmentBlob(sha256);
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

  const resolvedSrc = isEmbedded ? (objectUrl ?? attachmentUrl(sha256)) : src;
  return <img src={resolvedSrc} alt={alt} className="my-1 max-w-full rounded" />;
}

const INLINE_RE =
  /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]*)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-${i++}`;
    if (match[1] !== undefined) {
      nodes.push(<MarkdownImage key={key} alt={match[1]} src={match[2] as string} />);
    } else if (match[3] !== undefined) {
      nodes.push(
        <a key={key} href={match[4]} target="_blank" rel="noreferrer" className="text-blue-500 underline">
          {match[3]}
        </a>,
      );
    } else if (match[5] !== undefined) {
      nodes.push(<strong key={key}>{match[5]}</strong>);
    } else if (match[6] !== undefined) {
      nodes.push(
        <code key={key} className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">
          {match[6]}
        </code>,
      );
    } else if (match[7] !== undefined) {
      nodes.push(<em key={key}>{match[7]}</em>);
    } else if (match[8] !== undefined) {
      nodes.push(<em key={key}>{match[8]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/** 太字・斜体・コード・リンク・画像埋め込み・箇条書きに対応した最小限のMarkdownレンダラー */
export function renderMarkdown(text: string): ReactNode {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="ml-4 list-disc">
        {listBuffer.map((item, i) => (
          <li key={i}>{renderInline(item, `${key}-li-${i}`)}</li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  lines.forEach((line, idx) => {
    if (line.startsWith('- ')) {
      listBuffer.push(line.slice(2));
      return;
    }
    flushList(`list-${idx}`);
    if (line.trim() === '') {
      blocks.push(<br key={`br-${idx}`} />);
    } else {
      blocks.push(<p key={`p-${idx}`}>{renderInline(line, `p-${idx}`)}</p>);
    }
  });
  flushList('list-end');

  return blocks;
}

interface MarkdownFieldProps {
  value: string;
  onSave: (next: string) => void;
  ownerType: 'task' | 'note';
  ownerId: string;
  userId: string;
  rows?: number;
  placeholder?: string;
}

/**
 * クリックで編集(生のMarkdownをtextareaで編集、Ctrl+B/Ctrl+Iで装飾)、
 * blurで確定してレンダリング表示に戻る。画像の貼り付け/ドロップは既存の添付
 * パイプラインでアップロードしつつ、本文には sha256: 参照を埋め込む
 */
export function MarkdownField({ value, onSave, ownerType, ownerId, userId, rows = 6, placeholder }: MarkdownFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const wrapSelection = (marker: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value: current } = el;
    const selected = current.slice(selectionStart, selectionEnd);
    const next = `${current.slice(0, selectionStart)}${marker}${selected}${marker}${current.slice(selectionEnd)}`;
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart + marker.length, selectionEnd + marker.length);
    });
  };

  const insertImageRef = (sha256: string, filename: string) => {
    const el = textareaRef.current;
    const insertion = `![${filename}](sha256:${sha256})`;
    if (!el) {
      setDraft((d) => `${d}\n${insertion}`);
      return;
    }
    const { selectionStart, selectionEnd, value: current } = el;
    const next = `${current.slice(0, selectionStart)}${insertion}${current.slice(selectionEnd)}`;
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = selectionStart + insertion.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleImageFile = async (file: File) => {
    const processed = await processImageFile(file);
    await createAttachment(userId, ownerType, ownerId, processed, file.name);
    insertImageRef(processed.sha256, file.name);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    handleImageFile(file).catch((err) => console.error(err));
  };

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    handleImageFile(file).catch((err) => console.error(err));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrapSelection('**');
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrapSelection('_');
    }
  };

  if (!editing) {
    return (
      <div
        onClick={startEditing}
        className="min-h-[3rem] w-full cursor-text rounded border border-neutral-200 bg-transparent p-2 text-sm dark:border-neutral-700"
      >
        {value.trim() === '' ? (
          <span className="text-neutral-400">{placeholder}</span>
        ) : (
          renderMarkdown(value)
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <button
          onClick={() => wrapSelection('**')}
          title="太字（Ctrl/Cmd+B）"
          className="flex h-6 w-6 items-center justify-center rounded border border-neutral-200 text-neutral-500 dark:border-neutral-700"
        >
          <Bold size={12} />
        </button>
        <button
          onClick={() => wrapSelection('_')}
          title="斜体（Ctrl/Cmd+I）"
          className="flex h-6 w-6 items-center justify-center rounded border border-neutral-200 text-neutral-500 dark:border-neutral-700"
        >
          <Italic size={12} />
        </button>
      </div>
      <textarea
        ref={textareaRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDrop={handleDrop}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded border border-neutral-200 bg-transparent p-2 text-sm outline-none focus:border-blue-400 dark:border-neutral-700"
      />
    </div>
  );
}
