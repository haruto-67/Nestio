import { describe, expect, it } from 'vitest';
import { markdownToSafeHtml } from './markdown.js';

describe('markdownToSafeHtml', () => {
  it('太字・斜体・インラインコードを変換する', () => {
    expect(markdownToSafeHtml('**太字**と*斜体*と`code`')).toBe('<p><b>太字</b>と<i>斜体</i>と<code>code</code></p>');
  });

  it('コードスパン内のアンダースコアを斜体として誤変換しない', () => {
    expect(markdownToSafeHtml('`run_daily_script.sh`')).toBe('<p><code>run_daily_script.sh</code></p>');
  });

  it('コードスパン内のアスタリスクも太字/斜体として誤変換しない', () => {
    expect(markdownToSafeHtml('`a*b*c`')).toBe('<p><code>a*b*c</code></p>');
  });

  it('箇条書きをulに変換する', () => {
    expect(markdownToSafeHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('番号付きリストをolに変換する', () => {
    expect(markdownToSafeHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('見出しは太字段落に落とす（H1-H6は許可タグ外のため）', () => {
    expect(markdownToSafeHtml('# 見出し')).toBe('<p><b>見出し</b></p>');
  });

  it('空行区切りで段落を分け、段落内の改行はbrにする', () => {
    expect(markdownToSafeHtml('1行目\n2行目\n\n次の段落')).toBe('<p>1行目<br>2行目</p><p>次の段落</p>');
  });

  it('httpsリンクをaに変換する', () => {
    expect(markdownToSafeHtml('[Nestio](https://nestio.niwatorimc.com)')).toBe(
      '<p><a href="https://nestio.niwatorimc.com" target="_blank" rel="noopener noreferrer">Nestio</a></p>',
    );
  });

  it('javascript:スキームのリンク記法はaタグへ変換されない（href属性を持たない）', () => {
    const out = markdownToSafeHtml('[click](javascript:alert(1))');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href=');
  });

  it('生のHTMLタグはエスケープされ実行可能なマークアップにならない', () => {
    const out = markdownToSafeHtml('<script>alert(1)</script>');
    expect(out).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
});
