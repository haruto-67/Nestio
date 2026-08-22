export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

const ATTACHMENTS_GUIDE_URI = 'nestio://docs/attachments';

/**
 * MCPリソース一覧（改修20回目）。ツールのdescriptionは会話の毎ターンにコンテキストへ常駐する
 * ため簡潔に留め、実践手順・エラー対応表・運用上の注意点のような長文はリソースとして分離し、
 * 必要な時だけresources/readで取得させる。以前はNestioのメモ機能に同内容を書いていたが、
 * list_notesで偶然見つけてもらう他なく発見性が低かった
 */
export const RESOURCE_DEFS: ResourceDef[] = [
  {
    uri: ATTACHMENTS_GUIDE_URI,
    name: 'attachments-guide',
    description:
      'タスク/メモへの画像添付の実践ガイド。create_attachment_upload・create_attachment_download・' +
      'get_attachment・upload_attachmentを使う前、またはこれらでエラーが出た時に読むこと',
    mimeType: 'text/markdown',
  },
];

const ATTACHMENTS_GUIDE_CONTENT = `# Nestio 添付画像ガイド

タスク・メモへ画像を添付する／添付画像を読み出す際の実践手順とトラブルシュート。
各ツールのdescriptionだけでは分からない、運用上の注意点をまとめている。

## 前提

- 直接HTTP通信の手順を使うには、コード実行環境の許可ドメインに \`nestio.niwatorimc.com\` が
  入っている必要がある（設定 → Capabilities → コード実行とファイル作成 → ドメイン許可リスト）。
  apexの \`niwatorimc.com\` はサブドメインをカバーしないので不可
- 直接HTTP通信できない場合は \`upload_attachment\`（data_base64方式、目安8KB程度まで）のみが使える

## 重要な注意

**ツール一覧・リソース一覧は会話開始時に固定される。** サーバー側の変更やドメイン許可リストの
設定変更は今の会話には反映されない。挙動が古い・ツールが見当たらないと感じたら、まず新しい
会話を開始すること。

## 画像をアップロードする（推奨手順）

1. コード実行環境でアップロードするファイルのSHA-256を計算する（例: \`sha256sum file.png\`）
2. \`create_attachment_upload(owner_type, owner_id, filename, sha256)\` を呼ぶ
   → \`upload_url\` / \`upload_token\` / \`expires_at\` が返る
3. \`curl -X POST --data-binary @file.png -H "Authorization: Bearer <upload_token>" <upload_url>\`
   → 成功で201（content-addressedのため既に同じ実体が存在すれば200）
4. note/bodyには \`upload_url\` と同じパスを \`![代替テキスト](url)\` として書けばよい。
   POST成功時に添付レコードも自動作成されるため、別途 \`upload_attachment\` を呼ぶ必要は無い

### アップロードトークンの仕様
- 特定のsha256（バイト列）に紐付く。漏れても任意ファイルの設置には使えない
- TTL 5分
- sha256不一致・マジックバイト不正等でPOSTが失敗しても、同じトークンで**3回まで**再試行できる
- 再試行の上限に達しても \`create_attachment_upload\` を呼び直せば回復する
- 成功後の再送・期限切れは401 \`unauthenticated\`

## 画像を読み出す

- 1MB未満: \`get_attachment(sha256)\` で直接base64が返る
- 1MB超、または最初から大きいと分かっている場合:
  1. \`create_attachment_download(sha256)\` → \`download_url\` / \`download_token\` / \`expires_at\`
  2. \`curl -o out.png -H "Authorization: Bearer <download_token>" <download_url>\`
- ダウンロードトークンはTTL5分・**1回使い切り**（読み出しに副作用が無いため再試行の仕組みは無い）。
  失効・使用済みなら \`create_attachment_download\` を呼び直す

## エラー対応表

| 状況 | HTTP | code | 備考 |
|---|---|---|---|
| アップロードでsha256不一致・マジックバイト不正 | 400 | validation_failed | \`details.attempts_remaining\` に残り試行回数 |
| アップロードトークンの再試行上限（3回）超過 | 429 | rate_limited | \`create_attachment_upload\` を呼び直す |
| トークン無効・期限切れ・使用済み | 401 | unauthenticated | 呼び直しが必要 |
| 添付が見つからない | 404 | not_found | sha256を再確認 |

## upload_attachment（フォールバック）を使う場合の注意

data_base64はLLMが1文字ずつ出力する必要があり、**長いほど確率的に壊れやすい**（単純な
サイズ閾値の問題ではない）。コード実行環境から直接HTTP通信できる場面では、常に
\`create_attachment_upload\`を優先すること。
`;

const RESOURCE_CONTENTS: Record<string, string> = {
  [ATTACHMENTS_GUIDE_URI]: ATTACHMENTS_GUIDE_CONTENT,
};

export function findResourceDef(uri: string): ResourceDef | undefined {
  return RESOURCE_DEFS.find((r) => r.uri === uri);
}

export function readResourceContent(uri: string): string | undefined {
  return RESOURCE_CONTENTS[uri];
}
