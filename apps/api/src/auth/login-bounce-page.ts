function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Googleログインのcallback（クロスサイトからのリダイレクト）から、そのまま302で
 * 別のNestioページへ飛ばすと、ブラウザによっては「Googleを起点とする一連のクロスサイト
 * 遷移の延長」とみなし、直前に設定したばかりのSameSite=StrictのセッションCookieを
 * 次の遷移先には送らないことがある（改修17回目フォローアップ：MCPコネクタ連携時に
 * ログイン→認可画面がループする不具合の原因）。
 * 一度このページとして完全にロードさせ、そこからJSでナビゲーションさせることで
 * 「Nestio自身が起点の新しいナビゲーション」にし、Same-Site判定をリセットする
 */
export function renderLoginBouncePage(target: string): string {
  const safeTarget = escapeHtml(target);
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ログイン中…</title>
</head>
<body>
  <p>ログインしています…<a href="${safeTarget}">自動的に進まない場合はこちら</a></p>
  <script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
}
