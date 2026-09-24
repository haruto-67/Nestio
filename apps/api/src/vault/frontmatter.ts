/**
 * Obsidianノート先頭のYAML frontmatterを、Nestioが使うキー（description / category / tags）だけ
 * 解釈する最小限のパーサ／シリアライザ（改修25回目、docs/vault-spec.md 4章）。
 * それ以外のキー（Obsidian側で追加されたaliases等）は生の行のまま保持し、書き出し時にそのまま戻す。
 */

export interface NoteFrontmatter {
  description: string;
  category: string;
  tags: string[];
  /** description/category/tags以外のキーの生の行（継続行を含む）。元の順序のまま保持する */
  extra: string[];
}

export interface ParsedNote {
  frontmatter: NoteFrontmatter;
  body: string;
  hasFrontmatter: boolean;
}

const KEY_LINE = /^([A-Za-z_][\w-]*):\s*(.*)$/;
const LIST_ITEM = /^\s*-\s+(.*)$/;

function emptyFrontmatter(): NoteFrontmatter {
  return { description: '', category: '', tags: [], extra: [] };
}

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/** フロー形式 [a, "b, c"] を要素に分ける（クォート内のカンマでは分割しない） */
function splitFlowList(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"' && i + 1 < inner.length) {
        current += inner[++i];
      } else if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items.map(unquote).filter((t) => t.length > 0);
}

export function parseNote(content: string): ParsedNote {
  const text = content.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) {
    return { frontmatter: emptyFrontmatter(), body: text, hasFrontmatter: false };
  }
  const lines = text.split('\n');
  const closeIndex = lines.findIndex((l, i) => i > 0 && l === '---');
  if (closeIndex < 0) {
    return { frontmatter: emptyFrontmatter(), body: text, hasFrontmatter: false };
  }

  const fm = emptyFrontmatter();
  const block = lines.slice(1, closeIndex);
  let i = 0;
  while (i < block.length) {
    const line = block[i]!;
    const m = KEY_LINE.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    const value = m[2] ?? '';
    i++;

    if (key === 'description' || key === 'category') {
      fm[key] = unquote(value);
    } else if (key === 'tags') {
      const v = value.trim();
      if (v.startsWith('[') && v.endsWith(']')) {
        fm.tags = splitFlowList(v.slice(1, -1));
      } else if (v === '') {
        const tags: string[] = [];
        while (i < block.length) {
          const item = LIST_ITEM.exec(block[i]!);
          if (!item) break;
          const t = unquote(item[1] ?? '');
          if (t) tags.push(t);
          i++;
        }
        fm.tags = tags;
      } else {
        const t = unquote(v);
        fm.tags = t ? [t] : [];
      }
    } else {
      fm.extra.push(line);
      while (i < block.length && (/^\s/.test(block[i]!) || block[i]!.startsWith('- '))) {
        fm.extra.push(block[i]!);
        i++;
      }
    }
  }

  return { frontmatter: fm, body: lines.slice(closeIndex + 1).join('\n'), hasFrontmatter: true };
}

function quote(s: string): string {
  if (s === '' || /[:#[\]{},&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}

export function serializeNote(fm: NoteFrontmatter, body: string): string {
  const lines = [
    '---',
    `description: ${quote(fm.description)}`,
    `category: ${quote(fm.category)}`,
    `tags: [${fm.tags.map(quote).join(', ')}]`,
    ...fm.extra,
    '---',
  ];
  return `${lines.join('\n')}\n${body}`;
}
