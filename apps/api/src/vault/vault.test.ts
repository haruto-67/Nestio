import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseNote, serializeNote } from './frontmatter.js';
import { parseWikiLinkTargets, rewriteWikiLinks } from './wiki-links.js';
import { VaultError, normalizeNotePath, resolveInVault, validateTitle } from './paths.js';
import { VaultStore } from './store.js';
import { appendToSection, getOutline, getSection } from './outline.js';

const fm = (description: string, category = 'topic', tags: string[] = []) => ({ description, category, tags, extra: [] });

describe('frontmatter', () => {
  it('Nestioが使うキーを読み、それ以外のキーは生の行のまま保持する', () => {
    const parsed = parseNote('---\ndescription: 1行要約\ncategory: project\ntags: [a, "b c"]\naliases:\n  - 別名\n---\n# 本文\n');
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter).toEqual({
      description: '1行要約',
      category: 'project',
      tags: ['a', 'b c'],
      extra: ['aliases:', '  - 別名'],
    });
    expect(parsed.body).toBe('# 本文\n');
  });

  it('ブロック形式のtagsとCRLFを読める', () => {
    const parsed = parseNote('---\r\ntags:\r\n  - x\r\n  - y\r\n---\r\n本文');
    expect(parsed.frontmatter.tags).toEqual(['x', 'y']);
    expect(parsed.body).toBe('本文');
  });

  it('frontmatterが無い・閉じていない時は本文として扱う', () => {
    expect(parseNote('本文だけ')).toMatchObject({ hasFrontmatter: false, body: '本文だけ' });
    expect(parseNote('---\n閉じない').hasFrontmatter).toBe(false);
  });

  it('記号を含む値も書き出し→読み込みで元に戻る', () => {
    const original = { description: 'A: "引用" と # 記号', category: 'decision', tags: ['x,y', 'z'], extra: ['aliases: [別名]'] };
    const parsed = parseNote(serializeNote(original, '本文\n'));
    expect(parsed.frontmatter).toEqual(original);
    expect(parsed.body).toBe('本文\n');
  });
});

describe('wiki-links', () => {
  it('表示名・見出し付きのリンクからタイトルだけを取り出し、埋め込みは数えない', () => {
    expect(parseWikiLinkTargets('[[A]] [[B|表示]] [[C#見出し]] ![[img.png]] [[A]]')).toEqual(['A', 'B', 'C']);
  });

  it('リネーム時に表示名・見出しを保ったまま書き換える（大文字小文字は無視）', () => {
    expect(rewriteWikiLinks('[[old]] [[Old|別名]] [[old#h]] [[older]]', 'old', 'new')).toBe(
      '[[new]] [[new|別名]] [[new#h]] [[older]]',
    );
  });
});

describe('paths', () => {
  it('タイトルに使えない文字を拒否する', () => {
    expect(validateTitle('Mac Claude × Windowsローカルエージェント構想')).toBeNull();
    expect(validateTitle('a/b')).not.toBeNull();
    expect(validateTitle('a#b')).not.toBeNull();
    expect(validateTitle('.hidden')).not.toBeNull();
  });

  it('Vault外を指すパスを拒否する', () => {
    expect(normalizeNotePath('projects/Nestio/Nestio')).toBe('projects/Nestio/Nestio.md');
    expect(() => normalizeNotePath('../x')).toThrow(VaultError);
    expect(() => normalizeNotePath('/etc/passwd')).toThrow(VaultError);
    expect(() => normalizeNotePath('a/../../x')).toThrow(VaultError);
  });
});

describe('VaultStore', () => {
  let root: string;
  let outside: string;
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (outside) fs.rmSync(outside, { recursive: true, force: true });
  });
  const setup = () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-vault-'));
    return new VaultStore(root);
  };

  it('作成・読み取り・タイトル解決ができ、タイトルはVault全体で一意（大文字小文字無視）', () => {
    const vault = setup();
    const note = vault.create('projects/Nestio/Nestio.md', fm('ハブ', 'project'), '本文\n');
    expect(note.title).toBe('Nestio');
    expect(vault.findPathByTitle('nestio')).toBe('projects/Nestio/Nestio.md');
    expect(vault.resolve('Nestio')).toBe('projects/Nestio/Nestio.md');
    expect(() => vault.create('topics/NESTIO.md', fm('重複'), '')).toThrow(/同名/);
  });

  it('versionが食い違う更新は書き込まずconflictにする', () => {
    const vault = setup();
    const v1 = vault.create('topics/メモ.md', fm('説明'), '初版\n').version;
    const v2 = vault.writeContent('topics/メモ.md', serializeNote(fm('説明'), 'Obsidianで編集\n')).version;
    expect(v2).not.toBe(v1);

    let err: unknown;
    try {
      vault.update('topics/メモ.md', (c) => ({ frontmatter: c.frontmatter, body: '古い本文で上書き\n' }), v1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VaultError);
    expect((err as VaultError).code).toBe('conflict');
    expect(vault.read('topics/メモ.md').body).toBe('Obsidianで編集\n');

    vault.update('topics/メモ.md', (c) => ({ frontmatter: c.frontmatter, body: '最新から更新\n' }), v2);
    expect(vault.read('topics/メモ.md').body).toBe('最新から更新\n');
  });

  it('書き込み後に一時ファイルが残らない', () => {
    const vault = setup();
    vault.create('topics/a.md', fm('a'), 'x\n');
    expect(fs.readdirSync(path.join(root, 'topics'))).toEqual(['a.md']);
  });

  it('索引・検索・バックリンクは.trash/やattachments/を対象にしない', () => {
    const vault = setup();
    vault.create('topics/リンク元.md', fm('元'), '[[リンク先]] を参照。検索語あり\n');
    vault.create('topics/リンク先.md', fm('先'), '本文\n');
    vault.create('topics/消す.md', fm('消す'), '[[リンク先]] 検索語あり\n');
    vault.trash('topics/消す.md');
    fs.mkdirSync(path.join(root, 'attachments'), { recursive: true });
    fs.writeFileSync(path.join(root, 'attachments', 'x.md'), '検索語あり');

    expect([...vault.listNotePaths()].sort()).toEqual(['topics/リンク元.md', 'topics/リンク先.md'].sort());
    expect(vault.search('検索語').map((h) => h.title)).toEqual(['リンク元']);
    expect(vault.backlinks('リンク先').map((n) => n.title)).toEqual(['リンク元']);
    expect(fs.existsSync(path.join(root, '.trash', '消す.md'))).toBe(true);
  });

  it('リネーム時にVault内のリンクを書き換える', () => {
    const vault = setup();
    vault.create('topics/旧名.md', fm('対象'), '本文\n');
    vault.create('profile/参照する側.md', fm('参照', 'profile'), '[[旧名|表示]] と [[旧名#見出し]]\n');
    const { note, rewritten } = vault.move('topics/旧名.md', 'projects/X/新名.md');
    expect(note.path).toBe('projects/X/新名.md');
    expect(rewritten).toEqual(['profile/参照する側.md']);
    expect(vault.read('profile/参照する側.md').body).toBe('[[新名|表示]] と [[新名#見出し]]\n');
  });

  it('シンボリックリンク経由でVault外へ出るパスを拒否する', () => {
    const vault = setup();
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nestio-outside-'));
    fs.symlinkSync(outside, path.join(root, 'link'));
    expect(() => resolveInVault(root, 'link/x.md')).toThrow(VaultError);
    expect(() => vault.create('link/x.md', fm('x'), '')).toThrow(VaultError);
  });

  it('添付は同名があれば連番を付けて保存する', () => {
    const vault = setup();
    expect(vault.saveAttachment('図.png', Buffer.from([1]))).toBe('attachments/図.png');
    expect(vault.saveAttachment('図.png', Buffer.from([2]))).toBe('attachments/図 1.png');
    // パス部分は捨ててファイル名だけ使うのでVault外には書けない
    expect(vault.saveAttachment('../x.png', Buffer.from([1]))).toBe('attachments/x.png');
    expect(vault.attachmentPath('無い.png')).toBeNull();
    expect(vault.attachmentPath('.hidden')).toBeNull();
  });
});

describe('outline', () => {
  const body = '# A\na1\n\n## B\nb1\n\n## C\nc1\n';

  it('見出し一覧を返し、コードブロック内の#は見出しにしない', () => {
    expect(getOutline(body)).toEqual([
      { level: 1, text: 'A', line: 0 },
      { level: 2, text: 'B', line: 3 },
      { level: 2, text: 'C', line: 6 },
    ]);
    expect(getOutline('```\n# not heading\n```\n# real')).toEqual([{ level: 1, text: 'real', line: 3 }]);
  });

  it('同じか上位の次の見出しまでをセクションとして読む', () => {
    expect(getSection(body, 'B')).toBe('## B\nb1');
    expect(getSection(body, '## B')).toBe('## B\nb1');
    expect(getSection(body, 'A')).toBe('# A\na1\n\n## B\nb1\n\n## C\nc1');
    expect(getSection(body, '無い')).toBeNull();
  });

  it('セクション末尾に空行1つを挟んで追記する', () => {
    expect(appendToSection(body, 'B', '追記')).toBe('# A\na1\n\n## B\nb1\n\n追記\n\n## C\nc1\n');
    expect(appendToSection(body, 'C', '追記\n')).toBe('# A\na1\n\n## B\nb1\n\n## C\nc1\n\n追記\n');
    expect(appendToSection(body, '無い', 'x')).toBeNull();
  });
});
