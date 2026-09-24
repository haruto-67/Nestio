import { describe, expect, it } from 'vitest';
import { renderVaultMarkdown } from './render-markdown.js';

const opts = { attachmentUrl: (name: string) => `/api/v1/vault/attachments/${encodeURIComponent(name)}` };
const render = (md: string) => renderVaultMarkdown(md, opts);

describe('renderVaultMarkdown', () => {
  it('見出し・太字・[[リンク]]', () => {
    expect(render('# 題\n本文 **太字** と [[Nestio|ネスティオ]]')).toBe(
      '<h1>題</h1><p>本文 <strong>太字</strong> と <a class="wikilink" data-wikilink="Nestio">ネスティオ</a></p>',
    );
    expect(render('[[Nestio#要件]]')).toBe('<p><a class="wikilink" data-wikilink="Nestio">Nestio#要件</a></p>');
  });

  it('生のHTMLや危険なURLスキームは解釈しない', () => {
    expect(render('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
    expect(render('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
    expect(render('[[a" onclick="x]]')).toBe(
      '<p><a class="wikilink" data-wikilink="a&quot; onclick=&quot;x">a&quot; onclick=&quot;x</a></p>',
    );
  });

  it('入れ子リストとタスクリスト', () => {
    expect(render('- a\n  - b\n- [x] c\n- [ ] d')).toBe(
      '<ul><li>a<ul><li>b</li></ul></li><li class="task"><input type="checkbox" checked disabled> c</li>' +
        '<li class="task"><input type="checkbox" disabled> d</li></ul>',
    );
    expect(render('1. 一\n2. 二')).toBe('<ol><li>一</li><li>二</li></ol>');
  });

  it('表・コードブロック・引用・水平線', () => {
    expect(render('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(render('```ts\nconst a = "<b>";\n**x**\n```')).toBe('<pre><code>const a = &quot;&lt;b&gt;&quot;;\n**x**</code></pre>');
    expect(render('> 引用\n> **強調**')).toBe('<blockquote><p>引用<br><strong>強調</strong></p></blockquote>');
    expect(render('---')).toBe('<hr>');
  });

  it('コードスパンの中身とスネークケースは装飾しない', () => {
    expect(render('`run_daily_script.sh` と snake_case_name')).toBe(
      '<p><code>run_daily_script.sh</code> と snake_case_name</p>',
    );
  });

  it('画像の埋め込みと外部リンク', () => {
    expect(render('![[構成図.png]]')).toBe(
      '<p><img src="/api/v1/vault/attachments/%E6%A7%8B%E6%88%90%E5%9B%B3.png" alt="構成図.png"></p>',
    );
    expect(render('[GitHub](https://github.com) と https://example.com')).toBe(
      '<p><a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a> と ' +
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>',
    );
  });
});
