function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ConsentPageParams {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope: string;
}

export function renderConsentPage(clientName: string, params: ConsentPageParams): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nestio連携の許可</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 16px; color: #111; }
    button { width: 100%; padding: 12px; font-size: 16px; background: #111; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Nestio</h1>
  <p>「${escapeHtml(clientName)}」がNestioのタスク・メモへのアクセスを求めています。</p>
  <form method="POST" action="/api/v1/mcp/oauth/authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
    <input type="hidden" name="state" value="${escapeHtml(params.state)}">
    <input type="hidden" name="scope" value="${escapeHtml(params.scope)}">
    <button type="submit">許可する</button>
  </form>
</body>
</html>`;
}
