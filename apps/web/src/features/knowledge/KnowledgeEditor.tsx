import { useState, useEffect } from 'react';
import { uuidv7, type KnowledgeCategory, type KnowledgeWritableFields } from '@nestio/shared';
import { useApp } from '../../state/AppProvider.js';
import { useKnowledgeItem, useKnowledgeList, useTags, useKnowledgeTags } from '../../db/queries.js';
import {
  upsertKnowledge,
  deleteKnowledge,
  upsertTag,
  attachKnowledgeTag,
  deleteKnowledgeTag,
} from '../../state/actions.js';
import { MarkdownField } from '../notes/MarkdownField.js';
import { useResizableWidth } from '../../lib/useResizableWidth.js';
import { showToast } from '../../ui/toast.js';
import { CollapsibleSection } from '../../ui/CollapsibleSection.js';
import { CATEGORY_LABELS, CATEGORY_ORDER, computeBacklinks } from './categories.js';

interface KnowledgeEditorProps {
  knowledgeId: string;
  onClose: () => void;
  onOpenKnowledgeByTitle: (title: string) => void;
  /** 閉じるアニメーション中かどうか（NoteEditorと同じ仕組み） */
  closing?: boolean;
}

export function KnowledgeEditor({ knowledgeId, onClose, onOpenKnowledgeByTitle, closing = false }: KnowledgeEditorProps) {
  const { me } = useApp();
  const knowledge = useKnowledgeItem(knowledgeId);
  const allKnowledge = useKnowledgeList();
  const allTags = useTags();
  const knowledgeTags = useKnowledgeTags();
  const [titleDraft, setTitleDraft] = useState(knowledge?.title ?? '');
  const [descriptionDraft, setDescriptionDraft] = useState(knowledge?.description ?? '');
  const panelResize = useResizableWidth('nestio_knowledge_editor_width', 360, 260, 1400);

  useEffect(() => {
    setTitleDraft(knowledge?.title ?? '');
    setDescriptionDraft(knowledge?.description ?? '');
  }, [knowledge?.title, knowledge?.description, knowledgeId]);

  if (!knowledge || !me) return null;
  const userId = me.id;

  const update = (fields: KnowledgeWritableFields) => upsertKnowledge(userId, knowledgeId, fields);

  const remove = () => {
    deleteKnowledge(knowledgeId);
    onClose();
  };

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    if (trimmed === knowledge.title) return;
    if (trimmed === '') {
      showToast('タイトルは空にできません');
      setTitleDraft(knowledge.title);
      return;
    }
    const conflict = allKnowledge.some((k) => k.id !== knowledgeId && k.title === trimmed);
    if (conflict) {
      showToast('同じタイトルのナレッジが既にあります');
      setTitleDraft(knowledge.title);
      return;
    }
    update({ title: trimmed });
  };

  const commitDescription = () => {
    if (descriptionDraft !== knowledge.description) update({ description: descriptionDraft });
  };

  const wikiLinkTitles = allKnowledge.filter((k) => k.id !== knowledgeId).map((k) => k.title);
  const backlinks = computeBacklinks(allKnowledge, knowledge);

  const tagIdsForThis = new Set(knowledgeTags.filter((t) => t.knowledge_id === knowledgeId).map((t) => t.tag_id));
  const toggleTag = (tagId: string) => {
    const existing = knowledgeTags.find((t) => t.knowledge_id === knowledgeId && t.tag_id === tagId);
    if (existing) {
      deleteKnowledgeTag(existing.id);
    } else {
      void attachKnowledgeTag(userId, knowledgeId, tagId);
    }
  };
  const createAndAttachTag = (name: string) => {
    const tagId = uuidv7();
    upsertTag(userId, tagId, { name, color: '#888888' });
    void attachKnowledgeTag(userId, knowledgeId, tagId);
  };

  return (
    <div
      className="fixed inset-0 z-40 h-full max-md:!w-full overflow-x-hidden md:relative md:inset-auto md:z-auto md:shrink-0"
      style={{ width: panelResize.width }}
    >
      <div
        onMouseDown={(e) => panelResize.startResize(-1)(e)}
        title="ドラッグして幅を変更"
        className="group absolute top-0 left-0 z-10 hidden h-full w-3 -translate-x-1/2 cursor-col-resize touch-none md:block"
      >
        <div className="mx-auto h-full w-1 group-hover:bg-blue-400/60" />
      </div>
      <aside
        data-knowledge-detail-panel
        className={`flex h-full w-full shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-200 bg-white px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] dark:border-neutral-800 dark:bg-neutral-900 ${
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
          <button onClick={remove} className="text-sm text-red-500">
            削除
          </button>
        </div>

        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          placeholder="タイトル"
          className="w-full border-b border-transparent bg-transparent text-lg font-medium outline-none focus:border-blue-400"
        />

        <select
          value={knowledge.category}
          onChange={(e) => update({ category: e.target.value as KnowledgeCategory })}
          className="w-full rounded-md border border-neutral-200 bg-transparent p-1.5 text-sm dark:border-neutral-700"
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>

        <textarea
          value={descriptionDraft}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          onBlur={commitDescription}
          placeholder="説明（AIが本文を読むか判断するための1行要約）"
          rows={2}
          className="w-full resize-none rounded-md border border-neutral-200 bg-transparent p-2 text-sm outline-none focus:border-blue-400 dark:border-neutral-700"
        />

        <MarkdownField
          key={knowledgeId}
          value={knowledge.body}
          onSave={(body) => update({ body })}
          ownerType="knowledge"
          ownerId={knowledgeId}
          userId={userId}
          minHeight={220}
          placeholder="本文（[[タイトル]]で他のナレッジにリンクできます）"
          wikiLinkTitles={wikiLinkTitles}
        />

        <CollapsibleSection title="タグ" defaultOpen={tagIdsForThis.size > 0}>
          <div className="flex flex-wrap gap-1">
            {allTags.map((t) => {
              const active = tagIdsForThis.has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggleTag(t.id)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    active ? 'border-transparent text-white' : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'
                  }`}
                  style={active ? { backgroundColor: t.color } : undefined}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
          <KnowledgeTagCreator onCreate={createAndAttachTag} />
        </CollapsibleSection>

        <CollapsibleSection title="バックリンク" defaultOpen={backlinks.length > 0}>
          {backlinks.length === 0 ? (
            <p className="text-xs text-neutral-400">このノートを参照しているノートはありません</p>
          ) : (
            <div className="flex flex-col gap-1">
              {backlinks.map((b) => (
                <button
                  key={b.id}
                  onClick={() => onOpenKnowledgeByTitle(b.title)}
                  className="truncate rounded-md px-2 py-1 text-left text-sm text-blue-600 hover:bg-neutral-100 dark:text-blue-300 dark:hover:bg-neutral-800"
                >
                  {b.title}
                </button>
              ))}
            </div>
          )}
        </CollapsibleSection>
      </aside>
    </div>
  );
}

function KnowledgeTagCreator({ onCreate }: { onCreate: (name: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && value.trim()) {
          onCreate(value.trim());
          setValue('');
        }
      }}
      placeholder="新しいタグ名を入力してEnter"
      className="mt-1 rounded-md border border-neutral-200 bg-transparent p-1 text-xs dark:border-neutral-700"
    />
  );
}
