import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/**
 * ナレッジVault画面（改修25回目）。apps/apiの開発時既定VAULT_DIR（apps/api/data/vault）に
 * テスト用のmdを直接置き、フォルダツリー→表示→[[リンク]]遷移→ソース編集→保存の導線を確かめる。
 */
const API_DATA = path.resolve(import.meta.dirname, '../../api/data');
const DB_PATH = path.join(API_DATA, 'nestio.db');

let sessionId: string;
let vaultRoot: string;

test.beforeAll(() => {
  const db = new Database(DB_PATH);
  const userId = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    'INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, `e2e-sub-${userId}`, `${userId}@e2e.test`, 'E2Eナレッジ', now);
  sessionId = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, now + 24 * 60 * 60 * 1000, now);
  db.close();

  vaultRoot = path.join(API_DATA, 'vault', userId);
  fs.mkdirSync(path.join(vaultRoot, 'projects', 'Nestio'), { recursive: true });
  fs.writeFileSync(
    path.join(vaultRoot, 'projects', 'Nestio', 'Nestio.md'),
    '---\ndescription: タスク管理アプリ\ncategory: project\ntags: [nestio]\n---\n## 概要\n**自作**のタスク管理。詳細は [[Nestioの要件]]\n\n| 項目 | 値 |\n|---|---|\n| DB | SQLite |\n',
  );
  fs.writeFileSync(
    path.join(vaultRoot, 'projects', 'Nestio', 'Nestioの要件.md'),
    '---\ndescription: 要件\ncategory: project\ntags: []\n---\n- オフライン同期\n',
  );
});

test.afterAll(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'nestio_session', value: sessionId, domain: 'localhost', path: '/', httpOnly: true }]);
  await context.addInitScript(() => localStorage.setItem('nestio_last_screen', 'knowledge'));
});

test('フォルダツリーからノートを開き、[[リンク]]で移動し、ソース編集して保存できる', async ({ page }) => {
  await page.goto('/');

  const tree = page.locator('nav');
  await expect(tree.getByText('projects', { exact: true })).toBeVisible();
  await tree.locator('[data-vault-path="projects/Nestio/Nestio.md"]').click();

  const article = page.locator('article');
  await expect(article.locator('h2', { hasText: '概要' })).toBeVisible();
  await expect(article.locator('strong', { hasText: '自作' })).toBeVisible();
  await expect(article.locator('td', { hasText: 'SQLite' })).toBeVisible();
  await expect(article.getByText('タスク管理アプリ')).toBeVisible();
  await page.screenshot({ path: 'test-results/knowledge-view.png', fullPage: true });

  await article.locator('a.wikilink', { hasText: 'Nestioの要件' }).click();
  await expect(article.locator('h1', { hasText: 'Nestioの要件' })).toBeVisible();
  // バックリンクにハブノートが出る
  await expect(article.getByRole('button', { name: 'Nestio', exact: true })).toBeVisible();

  await page.locator('button[title="編集"]').click();
  const editor = page.locator('textarea');
  await expect(editor).toHaveValue(/オフライン同期/);
  await editor.fill(`${await editor.inputValue()}- 画面から追記\n`);
  await page.getByRole('button', { name: '保存' }).click();

  await expect(article.getByText('画面から追記')).toBeVisible();
  expect(fs.readFileSync(path.join(vaultRoot, 'projects', 'Nestio', 'Nestioの要件.md'), 'utf8')).toContain(
    '- 画面から追記',
  );
});

test('他で更新されたノートを古い内容で保存しようとすると上書きせず警告する', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-vault-path="projects/Nestio/Nestio.md"]').click();
  await page.locator('button[title="編集"]').click();

  // 編集中にObsidian側で書き換えられた想定
  const file = path.join(vaultRoot, 'projects', 'Nestio', 'Nestio.md');
  fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}Obsidianでの追記\n`);

  await page.locator('textarea').fill('---\ndescription: x\ncategory: project\n---\n古い画面からの保存\n');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('上書きはしていません')).toBeVisible();
  expect(fs.readFileSync(file, 'utf8')).toContain('Obsidianでの追記');
});
