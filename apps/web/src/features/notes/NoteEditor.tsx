import { useState, useEffect } from 'react';
import { Pin } from 'lucide-react';
import type { NoteWritableFields } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { useNote } from '../../db/queries.js';
import { upsertNote, deleteNote } from '../../state/actions.js';
import { AttachmentList } from '../attachments/AttachmentList.js';
import { MarkdownField } from './MarkdownField.js';
import { useResizableWidth } from '../../lib/useResizableWidth.js';

const NOTE_COLORS = ['#FFF7C0', '#FFD6D6', '#D6FFE0', '#D6E8FF', '#E8D6FF', '#FFFFFF'];

interface NoteEditorProps {
  noteId: string;
  onClose: () => void;
  /** 閉じるアニメーション中かどうか。trueの間はスライドアウトのクラスを適用する（改修12回目） */
  closing?: boolean;
}

export function NoteEditor({ noteId, onClose, closing = false }: NoteEditorProps) {
  const { me } = useApp();
  const note = useNote(noteId);
  const [titleDraft, setTitleDraft] = useState(note?.title ?? '');
  const panelResize = useResizableWidth('nestio_note_editor_width', 320, 220, 1400);

  useEffect(() => {
    setTitleDraft(note?.title ?? '');
  }, [note?.title, noteId]);

  if (!note || !me) return null;
  const userId = me.id;

  const update = (fields: NoteWritableFields) => upsertNote(userId, noteId, fields);

  const remove = () => {
    deleteNote(noteId);
    onClose();
  };

  return (
    <div
      // TaskDetailAreaと同じ設計（改修12回目）：モバイル幅ではPC用固定幅パネルのまま表示されて
      // 画面の左側に寄って見えてしまっていたため、fixedオーバーレイにしてタスク詳細と同じ
      // 右からのフルスクリーンpush遷移にする。背景色は敷かず、asideの背景（bg-white/dark:bg-neutral-900）
      // がスライドしてきた分だけ裏の一覧が隠れるようにする
      className="fixed inset-0 z-40 h-full max-md:!w-full overflow-x-hidden md:relative md:inset-auto md:z-auto md:shrink-0"
      style={{ width: panelResize.width }}
    >
      {/* TaskDetailPanelと同じ設計（改修6回目）：ハンドルは非スクロールの外枠に置く。
          モバイルではフルスクリーン表示なのでリサイズ操作自体が不要（改修12回目） */}
      <div
        onMouseDown={(e) => panelResize.startResize(-1)(e)}
        title="ドラッグして幅を変更"
        className="group absolute top-0 left-0 z-10 hidden h-full w-3 -translate-x-1/2 cursor-col-resize touch-none md:block"
      >
        <div className="mx-auto h-full w-1 group-hover:bg-blue-400/60" />
      </div>
      <aside
        className={`flex h-full w-full shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900 ${
          closing ? 'nestio-panel-slide-out' : 'nestio-panel-slide-in'
        }`}
      >
        <div className="flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            閉じる
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => update({ pinned: note.pinned === 1 ? 0 : 1 })}
              title="ピン留め"
              className={note.pinned === 1 ? 'text-amber-500' : 'text-neutral-400'}
            >
              <Pin size={16} />
            </button>
            <button onClick={remove} className="text-sm text-red-500">
              削除
            </button>
          </div>
        </div>

        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (titleDraft !== note.title) update({ title: titleDraft });
          }}
          placeholder="タイトル"
          className="w-full border-b border-transparent bg-transparent text-lg font-medium outline-none focus:border-blue-400"
        />

        <MarkdownField
          key={noteId}
          value={note.body}
          onSave={(body) => update({ body })}
          ownerType="note"
          ownerId={noteId}
          userId={userId}
          minHeight={220}
          placeholder="本文（Ctrl/Cmd+Bで太字、画像の貼り付け/ドロップに対応）"
        />

        <div className="flex gap-1.5">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => update({ color: c })}
              className={`h-6 w-6 rounded-full border-2 ${note.color === c ? 'border-blue-400' : 'border-surface-border'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <AttachmentList ownerType="note" ownerId={noteId} />
      </aside>
    </div>
  );
}
