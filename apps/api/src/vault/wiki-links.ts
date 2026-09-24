/**
 * Vault本文の[[リンク]]の抽出と書き換え（改修25回目、docs/vault-spec.md 5章・7章）。
 * [[タイトル]] / [[タイトル|表示名]] / [[タイトル#見出し]] に対応し、タイトル部分をファイル名として扱う。
 * ![[画像.png]] のような埋め込みはリンク（バックリンク）として数えない。
 */

const WIKI_LINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;

function splitTarget(inner: string): { title: string; rest: string } {
  const m = /^([^|#]*)(.*)$/s.exec(inner);
  return { title: (m?.[1] ?? '').trim(), rest: m?.[2] ?? '' };
}

/** 本文中の[[リンク]]先タイトル（重複なし、出現順） */
export function parseWikiLinkTargets(body: string): string[] {
  const titles = new Set<string>();
  for (const m of body.matchAll(WIKI_LINK)) {
    if (m[1] === '!') continue;
    const { title } = splitTarget(m[2] ?? '');
    if (title) titles.add(title);
  }
  return [...titles];
}

/** oldTitleを指す[[リンク]]（埋め込み含む）を、表示名・見出し部分を保ったままnewTitleへ書き換える */
export function rewriteWikiLinks(body: string, oldTitle: string, newTitle: string): string {
  const key = oldTitle.trim().toLowerCase();
  return body.replace(WIKI_LINK, (whole, bang: string, inner: string) => {
    const { title, rest } = splitTarget(inner);
    if (title.toLowerCase() !== key) return whole;
    return `${bang}[[${newTitle}${rest}]]`;
  });
}
