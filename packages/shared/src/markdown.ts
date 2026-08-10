/**
 * 軽量なMarkdown→HTML変換（改修8回目：ClaudeがMCP経由でtasks.note/notes.bodyに書き込む際、
 * **太字**等のMarkdown記法をそのまま生テキストとして保存すると装飾されずに表示されてしまう
 * 問題への対応）。
 *
 * apps/web側のMarkdownField（contentEditableのWYSIWYGリッチテキスト編集）が許可している
 * タグ・属性の範囲（B, STRONG, I, EM, BR, DIV, P, IMG, A, UL, OL, LI, CODE, SPAN）にだけ
 * 変換する。人間がUIで編集する際のWYSIWYG方針（Markdown記法へのパースはしない）は変えず、
 * この変換はMCP書き込み経路にのみ適用する。
 *
 * XSS対策：入力の生テキストは常にエスケープしてからテンプレートに埋め込み、生成するタグは
 * 固定の許可リストのみ。リンクはhttps/mailto以外のスキームを受け付けない
 * （正規表現の候補自体をhttps?:/mailto:始まりに限定しているため、javascript:等は構造的にマッチしない）。
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(rawLine: string): string {
  let out = escapeHtml(rawLine);
  out = out.replace(
    /\[([^[\]]+)\]\((https?:\/\/[^\s()]+|mailto:[^\s()]+)\)/g,
    (_m, text: string, url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');
  out = out.replace(/(?<!_)_([^_]+)_(?!_)/g, '<i>$1</i>');
  return out;
}

const UNORDERED_ITEM = /^[-*]\s+(.*)$/;
const ORDERED_ITEM = /^\d+\.\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;

export function markdownToSafeHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(`<p><b>${renderInline(heading[1] ?? '')}</b></p>`);
      i++;
      continue;
    }

    if (UNORDERED_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = UNORDERED_ITEM.exec(lines[i] ?? '');
        if (!m) break;
        items.push(`<li>${renderInline(m[1] ?? '')}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (ORDERED_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const m = ORDERED_ITEM.exec(lines[i] ?? '');
        if (!m) break;
        items.push(`<li>${renderInline(m[1] ?? '')}</li>`);
        i++;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (l.trim() === '' || UNORDERED_ITEM.test(l) || ORDERED_ITEM.test(l) || HEADING.test(l)) break;
      paraLines.push(renderInline(l));
      i++;
    }
    blocks.push(`<p>${paraLines.join('<br>')}</p>`);
  }

  return blocks.join('');
}
