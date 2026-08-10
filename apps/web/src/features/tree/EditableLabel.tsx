import { useState, useImperativeHandle, forwardRef, type KeyboardEvent } from 'react';

interface EditableLabelProps {
  value: string;
  className?: string;
  onCommit: (next: string) => void;
}

export interface EditableLabelHandle {
  startEditing: () => void;
}

/**
 * ダブルクリックで編集モードに入り、Enter/blurで確定、Escapeで取り消す。
 * タッチ操作ではダブルクリックに頼れないため、外部（例: リネームボタン）から
 * startEditing() で編集モードへ入れるようrefのハンドルも公開する
 */
export const EditableLabel = forwardRef<EditableLabelHandle, EditableLabelProps>(function EditableLabel(
  { value, className, onCommit },
  ref,
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useImperativeHandle(
    ref,
    () => ({
      startEditing: () => {
        setDraft(value);
        setEditing(true);
      },
    }),
    [value],
  );

  if (!editing) {
    return (
      <span
        className={className}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // IME変換確定のEnterと入力確定のEnterを区別する（日本語入力中に変換確定しただけで
    // リネームが確定してしまうのを防ぐ。改修8回目）
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
    if (e.key === 'Escape') {
      setDraft(value);
      setEditing(false);
    }
  };

  return (
    <input
      autoFocus
      onFocus={(e) => e.target.select()}
      className={`${className} bg-transparent outline-none ring-1 ring-blue-400`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
    />
  );
});
