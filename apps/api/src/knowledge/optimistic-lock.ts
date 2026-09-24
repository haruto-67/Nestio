/**
 * upsert_knowledge の楽観ロック判定（改修25回目：lost update対策）。
 * 問題が無ければ null、書き込みを拒否すべきならエラーメッセージを返す。
 * expectedSeq が undefined の時は従来どおりチェックしない。
 */
export function checkExpectedSeq(
  title: string,
  currentSeq: number | null,
  expectedSeq: unknown,
): string | null {
  if (expectedSeq === undefined) {
    return null;
  }
  if (typeof expectedSeq !== 'number') {
    return 'expected_seqは数値で指定してください';
  }
  if (currentSeq === null) {
    return `expected_seqが指定されましたが、ナレッジ「${title}」は存在しません`;
  }
  if (currentSeq !== expectedSeq) {
    return `競合: ナレッジ「${title}」は読み取り後に更新されています（expected_seq=${expectedSeq}, 現在のseq=${currentSeq}）。get_knowledgeで読み直してから再実行してください`;
  }
  return null;
}