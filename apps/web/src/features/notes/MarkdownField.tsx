import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Bold, Italic, Code, List, ListOrdered, Link as LinkIcon } from 'lucide-react';
import { createAttachment } from '../../state/actions.js';
import { attachmentUrl } from '../../api/attachments.js';
import { processImageFile } from '../../lib/image-processing.js';
import { showToast } from '../../ui/toast.js';
import { ImageLightbox } from '../../ui/ImageLightbox.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'BR', 'DIV', 'P', 'IMG', 'A', 'UL', 'OL', 'LI', 'CODE', 'SPAN']);
const ALLOWED_ATTRS: Record<string, string[]> = {
  IMG: ['src', 'alt'],
  A: ['href', 'target', 'rel'],
};

function isSafeUrl(attr: string, value: string): boolean {
  if (attr === 'src') return !/^\s*javascript:/i.test(value);
  if (attr === 'href') return /^\s*(https?:|mailto:|#)/i.test(value) || value === '';
  return true;
}

function sanitizeNode(node: Node): Node | DocumentFragment | null {
  if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;

  if (!ALLOWED_TAGS.has(el.tagName)) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return null;
    const frag = document.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const cleaned = sanitizeNode(child);
      if (cleaned) frag.appendChild(cleaned);
    }
    return frag;
  }

  const clean = document.createElement(el.tagName);
  for (const attr of ALLOWED_ATTRS[el.tagName] ?? []) {
    const v = el.getAttribute(attr);
    if (v !== null && isSafeUrl(attr, v)) clean.setAttribute(attr, v);
  }
  for (const child of Array.from(el.childNodes)) {
    const cleaned = sanitizeNode(child);
    if (cleaned) clean.appendChild(cleaned);
  }
  return clean;
}

/** 自前生成のHTML以外（貼り付け等）が混ざっても安全なタグ/属性だけに絞り込む */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container = document.createElement('div');
  for (const child of Array.from(doc.body.childNodes)) {
    const cleaned = sanitizeNode(child);
    if (cleaned) container.appendChild(cleaned);
  }
  return container.innerHTML;
}

interface MarkdownFieldProps {
  value: string;
  onSave: (next: string) => void;
  ownerType: 'task' | 'note' | 'knowledge';
  ownerId: string;
  userId: string;
  placeholder?: string;
  minHeight?: number;
  /**
   * [[ を入力した時にタイトル補完を出す候補一覧（ナレッジ本文編集時のみ渡す。改修24回目
   * フォローアップ）。渡さなければ補完機能自体が無効になる
   */
  wikiLinkTitles?: string[];
}

interface LinkSuggestionState {
  matches: string[];
  /** contentEditable要素内での相対位置（同じ要素内をスクロールしても追従するように親要素基準で持つ） */
  top: number;
  left: number;
}

const MAX_LINK_SUGGESTIONS = 8;

/**
 * contentEditableベースのリッチテキスト編集。閲覧時と編集時で同じDOM要素を使うため
 * 編集開始時にボックスが縮む/被る問題が構造的に起きない。保存形式はサニタイズ済みHTML
 * （schema上はTEXT列のまま。Markdown記法へのパースは行わず、見たまま編集・見たまま表示にする）
 */
export function MarkdownField({
  value,
  onSave,
  ownerType,
  ownerId,
  userId,
  placeholder,
  minHeight = 96,
  wikiLinkTitles,
}: MarkdownFieldProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(value.trim() === '');
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [linkSuggestion, setLinkSuggestion] = useState<LinkSuggestionState | null>(null);
  const [linkHighlight, setLinkHighlight] = useState(0);

  // 外部からvalueが変わった時だけDOMへ反映する（自分の入力中に書き換えるとカーソル位置が飛ぶため）
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
      setIsEmpty(ref.current.textContent?.trim() === '' && !ref.current.querySelector('img'));
    }
  }, [value]);

  const commit = () => {
    setEditing(false);
    setLinkSuggestion(null);
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeHtml(el.innerHTML);
    if (clean !== value) onSave(clean);
  };

  const startEditing = () => {
    setEditing(true);
    requestAnimationFrame(() => ref.current?.focus());
  };

  /** キャレット直前の"[[部分入力"を検出し、一致するタイトル候補があれば補完ドロップダウンを出す
   * （改修24回目フォローアップ：[[リンク]]のパースとバックリンク）。ownerType='knowledge'かつ
   * wikiLinkTitlesが渡された時のみ有効 */
  const updateLinkSuggestion = () => {
    if (!wikiLinkTitles || wikiLinkTitles.length === 0) {
      setLinkSuggestion(null);
      return;
    }
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      setLinkSuggestion(null);
      return;
    }
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
      setLinkSuggestion(null);
      return;
    }
    const text = node.textContent ?? '';
    const offset = sel.anchorOffset;
    const match = /\[\[([^[\]]*)$/.exec(text.slice(0, offset));
    if (!match) {
      setLinkSuggestion(null);
      return;
    }
    const query = (match[1] ?? '').toLowerCase();
    const matches = wikiLinkTitles.filter((t) => t.toLowerCase().includes(query)).slice(0, MAX_LINK_SUGGESTIONS);
    if (matches.length === 0) {
      setLinkSuggestion(null);
      return;
    }
    const range = sel.getRangeAt(0).cloneRange();
    const caretRect = range.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    setLinkHighlight(0);
    setLinkSuggestion({
      matches,
      top: caretRect.bottom - elRect.top + el.scrollTop,
      left: caretRect.left - elRect.left + el.scrollLeft,
    });
  };

  const acceptLinkSuggestion = (title: string) => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? '';
    const offset = sel.anchorOffset;
    const match = /\[\[([^[\]]*)$/.exec(text.slice(0, offset));
    if (!match || match.index === undefined) return;

    const range = document.createRange();
    range.setStart(node, match.index + 2);
    range.setEnd(node, offset);
    range.deleteContents();
    const textNode = document.createTextNode(`${title}]]`);
    range.insertNode(textNode);

    const newRange = document.createRange();
    newRange.setStartAfter(textNode);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);

    setLinkSuggestion(null);
    el.focus();
    handleInput();
  };

  const handleInput = () => {
    setIsEmpty((ref.current?.textContent?.trim() === '' && !ref.current.querySelector('img')) ?? true);
    updateLinkSuggestion();
  };

  // 画像クリックで拡大表示（改修16回目）・リンククリックで新しいタブを開く（改修23回目）。
  // onClickではなくonMouseDownでpreventDefaultする：未編集状態からの最初のクリックは
  // mousedown時点でフォーカスが入り、直後にeditingがtrueになってツールバーが上に出現し
  // レイアウトが下へシフトする。onClickまで待つとその頃には座標がズレてしまい、
  // まさにクリックした画像/リンクの上にツールバンのボタン等が来て意図しない要素に当たる
  // ことがあるため、シフトが起きる前のmousedown時点で止める必要がある
  //
  // リンクは、contentEditable内の<a>は通常クリックでは遷移せずキャレット配置のみが起きるため、
  // target/relを付けてリンク化しても（insertLink参照）実際にはクリックしても何も起きず
  // 「リンク機能が使えない」状態になっていた。画像と同じ理由でpreventDefaultしキャレット配置・
  // フォーカスを止め、代わりに明示的にwindow.openで遷移する
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target;
    if (target instanceof HTMLImageElement) {
      e.preventDefault();
      setLightboxImage({ src: target.src, alt: target.alt });
      return;
    }
    const link = target instanceof HTMLElement ? target.closest('a') : null;
    if (link?.href) {
      e.preventDefault();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    }
  };

  const insertImage = (url: string, alt: string) => {
    const el = ref.current;
    if (!el) return;
    if (!editing) {
      setEditing(true);
      requestAnimationFrame(() => el.focus());
    }
    el.focus();
    document.execCommand('insertHTML', false, `<img src="${url}" alt="${alt}">`);
    handleInput();
  };

  const handleImageFile = async (file: File) => {
    // ナレッジは添付テーブルのowner_type CHECK制約（'task'|'note'のみ）の対象外のため未対応
    if (ownerType === 'knowledge') {
      showToast('ナレッジへの画像添付は未対応です');
      return;
    }
    const processed = await processImageFile(file);
    await createAttachment(userId, ownerType, ownerId, processed, file.name);
    insertImage(attachmentUrl(processed.sha256), file.name);
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      handleImageFile(file).catch((err) => console.error(err));
      return;
    }
    // 外部からのリッチHTML貼り付けはタグを持ち込ませず、プレーンテキストとしてのみ挿入する
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    handleImageFile(file).catch((err) => console.error(err));
  };

  // コード化・リンク化は選択範囲が無いと対象が決まらないため、未選択時は何もしない
  // （太字/斜体はブラウザネイティブのトグル挙動で無選択でも「次に打つ文字」に効くが、
  // <code>/<a>にはそれに相当する標準コマンドが無い）
  const toggleCode = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      showToast('コードにしたい文字列を選択してください');
      return;
    }
    document.execCommand('insertHTML', false, `<code>${escapeHtml(selection.toString())}</code>`);
    handleInput();
  };

  const toggleUnorderedList = () => {
    ref.current?.focus();
    document.execCommand('insertUnorderedList');
    handleInput();
  };

  const toggleOrderedList = () => {
    ref.current?.focus();
    document.execCommand('insertOrderedList');
    handleInput();
  };

  const insertLink = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      showToast('リンクにしたい文字列を選択してください');
      return;
    }
    const url = window.prompt('リンク先URL（https://... または mailto:...）');
    if (!url) return;
    if (!/^(https?:|mailto:)/i.test(url)) {
      showToast('httpsまたはmailtoで始まるURLのみ使えます');
      return;
    }
    document.execCommand('createLink', false, url);
    // execCommandが生成する<a>にはtarget/relが付かないため、新しいタブで開けるよう補う
    el.querySelectorAll('a:not([target])').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    handleInput();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (linkSuggestion) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setLinkSuggestion(null);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setLinkHighlight((i) => (i + 1) % linkSuggestion.matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setLinkHighlight((i) => (i - 1 + linkSuggestion.matches.length) % linkSuggestion.matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const title = linkSuggestion.matches[linkHighlight] ?? linkSuggestion.matches[0];
        if (title) acceptLinkSuggestion(title);
        return;
      }
    }

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    // 箇条書き/番号付きリストはGoogle Docs等でおなじみのCtrl/Cmd+Shift+8/7。数字キーは
    // キーボードレイアウトによってShift併用時の生成文字（e.key）が変わるため、
    // レイアウトに依存しない物理キー位置（e.code）で判定する
    if (e.shiftKey && e.code === 'Digit8') {
      e.preventDefault();
      toggleUnorderedList();
      return;
    }
    if (e.shiftKey && e.code === 'Digit7') {
      e.preventDefault();
      toggleOrderedList();
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'b') {
      e.preventDefault();
      document.execCommand('bold');
    } else if (key === 'i') {
      e.preventDefault();
      document.execCommand('italic');
    } else if (key === 'e') {
      e.preventDefault();
      toggleCode();
    } else if (key === 'k') {
      e.preventDefault();
      insertLink();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {editing && (
        <div className="flex flex-wrap gap-1">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              ref.current?.focus();
              document.execCommand('bold');
            }}
            title="太字（Ctrl/Cmd+B）"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 dark:border-neutral-700"
          >
            <Bold size={12} />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              ref.current?.focus();
              document.execCommand('italic');
            }}
            title="斜体（Ctrl/Cmd+I）"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 dark:border-neutral-700"
          >
            <Italic size={12} />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleCode}
            title="コード（選択してCtrl/Cmd+E）"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 dark:border-neutral-700"
          >
            <Code size={12} />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleUnorderedList}
            title="箇条書き（Ctrl/Cmd+Shift+8）"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 dark:border-neutral-700"
          >
            <List size={12} />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleOrderedList}
            title="番号付きリスト（Ctrl/Cmd+Shift+7）"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 dark:border-neutral-700"
          >
            <ListOrdered size={12} />
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={insertLink}
            title="リンク（選択してCtrl/Cmd+K）"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 dark:border-neutral-700"
          >
            <LinkIcon size={12} />
          </button>
        </div>
      )}
      <div className="relative">
        {isEmpty && (
          <span className="pointer-events-none absolute top-2 left-2 text-sm text-neutral-400">{placeholder}</span>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onFocus={startEditing}
          onBlur={commit}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onMouseDown={handleMouseDown}
          style={{ minHeight }}
          data-markdown-field="true"
          className="w-full resize-y overflow-auto rounded-md border border-neutral-200 bg-transparent p-2 text-sm text-neutral-900 outline-none focus:border-blue-400 dark:border-neutral-700 dark:text-white [&_a]:text-blue-500 [&_a]:underline [&_code]:rounded [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] dark:[&_code]:bg-neutral-800 [&_img]:my-1 [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-md [&_ol]:ml-4 [&_ol]:list-decimal [&_ul]:ml-4 [&_ul]:list-disc"
        />
        {linkSuggestion && (
          <div
            style={{ top: linkSuggestion.top, left: linkSuggestion.left }}
            className="absolute z-20 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          >
            {linkSuggestion.matches.map((title, i) => (
              <button
                key={title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => acceptLinkSuggestion(title)}
                className={`block w-full truncate px-2 py-1 text-left text-xs ${
                  i === linkHighlight ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : ''
                }`}
              >
                {title}
              </button>
            ))}
          </div>
        )}
      </div>
      {lightboxImage && (
        <ImageLightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />
      )}
    </div>
  );
}
