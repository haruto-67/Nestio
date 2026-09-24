/**
 * 見出し単位の部分読み取り・部分追記（改修25回目、docs/vault-spec.md 5章）。
 * 1ナレッジ全体をコンテキストに載せずに必要なセクションだけ扱えるようにする。
 */

export interface Heading {
  level: number;
  text: string;
  /** 本文の行番号（0始まり） */
  line: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^(```|~~~)/;

export function getOutline(body: string): Heading[] {
  const headings: Heading[] = [];
  let inFence = false;
  body.split('\n').forEach((line, i) => {
    if (FENCE.test(line.trimStart())) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = HEADING.exec(line);
    if (m) headings.push({ level: m[1]!.length, text: m[2]!.trim(), line: i });
  });
  return headings;
}

/** 見出し行から、同じかそれより上位の次の見出しの直前までの行範囲 [start, end)。末尾の空行は含めない */
function sectionRange(lines: string[], outline: Heading[], heading: string): { start: number; end: number } | null {
  const key = heading.trim().replace(/^#+\s*/, '');
  const idx = outline.findIndex((h) => h.text === key);
  if (idx < 0) return null;
  const target = outline[idx]!;
  const next = outline.slice(idx + 1).find((h) => h.level <= target.level);
  let end = next ? next.line : lines.length;
  while (end > target.line + 1 && lines[end - 1]!.trim() === '') end--;
  return { start: target.line, end };
}

export function getSection(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const range = sectionRange(lines, getOutline(body), heading);
  if (!range) return null;
  return lines.slice(range.start, range.end).join('\n');
}

export function appendToSection(body: string, heading: string, text: string): string | null {
  const lines = body.split('\n');
  const outline = getOutline(body);
  const range = sectionRange(lines, outline, heading);
  if (!range) return null;

  const before = lines.slice(0, range.end);
  const after = lines.slice(range.end);
  // セクション末尾と次の見出しの間にあった空行は捨て、空行1つで区切り直す
  while (after.length > 0 && after[0]!.trim() === '') after.shift();
  const inserted = ['', ...text.trimEnd().split('\n')];
  if (after.length > 0) return [...before, ...inserted, '', ...after].join('\n');
  return `${[...before, ...inserted].join('\n')}\n`;
}
