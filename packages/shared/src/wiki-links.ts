/**
 * ナレッジ本文（保存済みHTML。markdownToSafeHtmlは[[ ]]に手を入れないため元のまま残る）から
 * [[タイトル]] を抽出する。[[タイトル|表示名]] の表示名部分は無視してタイトルだけを解決キーにする
 * （改修24回目フォローアップ：Obsidianと同じくパスではなくタイトル完全一致で解決する）。
 * サーバー側（knowledge_linksへの反映）とクライアント側（ローカルのバックリンク計算）で共用する。
 */
export function parseLinkedTitles(body: string): string[] {
  const titles = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const title = (m[1] ?? '').split('|')[0]?.trim();
    if (title) titles.add(title);
  }
  return [...titles];
}
