/**
 * ナレッジVaultのMarkdown（GFMの主要部分＋Obsidianの[[リンク]]・![[埋め込み]]）を安全なHTMLへ変換する
 * （改修25回目）。付箋・タスクのmarkdownToSafeHtmlはWYSIWYG編集の許可タグに合わせた軽量版で
 * 見出し・表・コードブロックを出せないため、閲覧専用のこちらを別に持つ。
 *
 * XSS対策：入力テキストは常にエスケープしてから記法を当てる。生のHTMLは文字として表示する。
 * リンクURLはhttps/http/mailtoのみ、画像URLはhttps/httpと添付URLのみ許可する。
 */

export interface RenderOptions {
  /** ![[ファイル名]] の画像URLを返す */
  attachmentUrl: (fileName: string) => string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(raw: string, opts: RenderOptions): string {
  const stash: string[] = [];
  const keep = (html: string) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  // コードスパン・リンク類は先に退避し、中身が太字等の記法として再解釈されないようにする
  let s = raw.replace(/`([^`]+)`/g, (_m, code: string) => keep(`<code>${escapeHtml(code)}</code>`));

  s = s.replace(/!\[\[([^[\]\n]+?)\]\]/g, (_m, name: string) => {
    const file = name.split('|')[0]!.trim();
    return keep(`<img src="${escapeHtml(opts.attachmentUrl(file))}" alt="${escapeHtml(file)}">`);
  });

  s = s.replace(/\[\[([^[\]\n]+?)\]\]/g, (_m, inner: string) => {
    const [target = '', alias] = inner.split('|');
    const title = target.split('#')[0]!.trim();
    const label = alias?.trim() || target.trim();
    return keep(`<a class="wikilink" data-wikilink="${escapeHtml(title)}">${escapeHtml(label)}</a>`);
  });

  s = s.replace(/!\[([^[\]]*)\]\((https?:\/\/[^\s()]+)\)/g, (_m, alt: string, url: string) =>
    keep(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`),
  );

  s = s.replace(/\[([^[\]]+)\]\(((?:https?:|mailto:)[^\s()]+)\)/gi, (_m, text: string, url: string) =>
    keep(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`),
  );

  s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<>()（）]+)/g, (_m, pre: string, url: string) =>
    pre + keep(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`),
  );

  s = escapeHtml(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/(?<!\*)\*([^*\s][^*]*)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<![\w\\])_([^_]+)_(?![\w])/g, '<em>$1</em>');

  // eslint-disable-next-line no-control-regex
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => stash[Number(i)] ?? '');
}

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    line.startsWith('>') ||
    LIST_ITEM.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP.test(next))
  );
}

interface ListItem {
  indent: number;
  ordered: boolean;
  text: string;
}

function renderList(items: ListItem[], opts: RenderOptions): string {
  let html = '';
  let i = 0;
  const renderLevel = (indent: number): string => {
    const ordered = items[i]!.ordered;
    let out = ordered ? '<ol>' : '<ul>';
    while (i < items.length && items[i]!.indent >= indent) {
      const item = items[i]!;
      if (item.indent > indent) {
        out += renderLevel(item.indent);
        continue;
      }
      i++;
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item.text);
      let li = task
        ? `<li class="task"><input type="checkbox"${task[1] === ' ' ? '' : ' checked'} disabled> ${renderInline(task[2]!, opts)}`
        : `<li>${renderInline(item.text, opts)}`;
      if (i < items.length && items[i]!.indent > indent) li += renderLevel(items[i]!.indent);
      out += `${li}</li>`;
    }
    return out + (ordered ? '</ol>' : '</ul>');
  };
  while (i < items.length) html += renderLevel(items[i]!.indent);
  return html;
}

export function renderVaultMarkdown(markdown: string, opts: RenderOptions): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) code.push(lines[i++]!);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2]!, opts)}</h${level}>`);
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (line.startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) quoted.push(lines[i++]!.replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderVaultMarkdown(quoted.join('\n'), opts)}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') rows.push(splitRow(lines[i++]!));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${renderInline(c, opts)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, opts)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]!);
        if (m) {
          items.push({ indent: m[1]!.replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]!), text: m[3]! });
          i++;
        } else if (lines[i]!.trim() !== '' && /^\s+/.test(lines[i]!) && items.length > 0) {
          // 項目の継続行（インデントされた折り返し）
          items[items.length - 1]!.text += ` ${lines[i]!.trim()}`;
          i++;
        } else {
          break;
        }
      }
      out.push(renderList(items, opts));
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && (para.length === 0 || !isBlockStart(lines[i]!, lines[i + 1]))) {
      para.push(renderInline(lines[i]!, opts));
      i++;
    }
    out.push(`<p>${para.join('<br>')}</p>`);
  }

  return out.join('');
}
