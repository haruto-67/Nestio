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

  // 画像 ![alt](url)（改修15回目：MCP経由でスクリーンショット等を貼れるようにする要望への
  // 対応。リンクの[text](url)記法とは先頭の!だけが違うため、リンクより先に処理しないと
  // 画像記法がリンクとして誤変換されてしまう。urlはhttps/data:image(base64)/添付URL
  // （/api/v1/attachments/<sha256>）のみ許可し、javascript:等は正規表現の候補自体が
  // 構造的にマッチしないため受け付けない。/api/v1/attachments/形式は改修16回目：
  // upload_attachmentツールでアップロードした画像を参照する用途（data URIを直接
  // 書き込む方式は、長大なbase64をツール呼び出し引数として生成する過程でごく低い確率で
  // 文字化けし画像が壊れることが判明したため、こちらを推奨経路にした）
  out = out.replace(
    /!\[([^[\]]*)\]\((https?:\/\/[^\s()]+|data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+|\/api\/v1\/attachments\/[0-9a-f]{64})\)/g,
    (_m, alt: string, url: string) => `<img src="${url}" alt="${alt}">`,
  );

  out = out.replace(
    /\[([^[\]]+)\]\((https?:\/\/[^\s()]+|mailto:[^\s()]+)\)/g,
    (_m, text: string, url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );

  // コードスパンはCommonMark同様、他の記法（太字・斜体等）の解釈対象から除外する。先に
  // `<code>`へ変換してプレースホルダー（NUL文字で挟んだ連番。通常の入力には出現しない）に
  // 退避させないと、後続の太字/斜体の正規表現がコードスパンの中身のアンダースコア/
  // アスタリスクにまでマッチしてしまう（改修12回目：`run_daily_script.sh`のような
  // スネークケースの識別子が、アンダースコアの間の文字列を斜体として誤変換されるバグの修正）
  const codeSpans: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\0${codeSpans.length - 1}\0`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');
  out = out.replace(/(?<!_)_([^_]+)_(?!_)/g, '<i>$1</i>');

  out = out.replace(/\0(\d+)\0/g, (_m, idx: string) => codeSpans[Number(idx)] ?? '');
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
