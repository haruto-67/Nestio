import { test, expect } from '@playwright/test';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

/** apps/api/data/nestio.db。webServer/reuseExistingServerどちらの場合もこのパスで動く（本文コメント参照） */
const DB_PATH = path.resolve(import.meta.dirname, '../../api/data/nestio.db');

function uuidv7(): string {
  const unixTsMs = BigInt(Date.now());
  const bytes = new Uint8Array(16);
  bytes[0] = Number((unixTsMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTsMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTsMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTsMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTsMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTsMs & 0xffn);
  const rand = crypto.randomBytes(10);
  bytes[6] = 0x70 | (rand[0] & 0x0f);
  bytes[7] = rand[1];
  bytes[8] = 0x80 | (rand[2] & 0x3f);
  for (let i = 9; i < 16; i++) bytes[i] = rand[i - 3];
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let sessionId: string;
let listId: string;

test.beforeAll(() => {
  const db = new Database(DB_PATH);
  const userId = uuidv7();
  const now = Date.now();
  db.prepare(
    'INSERT INTO users (id, google_sub, email, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, `e2e-sub-${userId}`, `${userId}@e2e.test`, 'E2Eテストユーザー', now);

  sessionId = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    'INSERT INTO sessions (id, user_id, device_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(sessionId, userId, now + 30 * 24 * 60 * 60 * 1000, now);

  listId = uuidv7();
  db.prepare(
    'INSERT INTO lists (id, user_id, name, sort_order, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(listId, userId, 'E2Eスモークテスト用リスト', 1, now, now, 1);

  db.close();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: 'nestio_session', value: sessionId, domain: 'localhost', path: '/', httpOnly: true },
  ]);
});

test('ログイン→タスク作成→完了→削除→ゴミ箱から復元の一連の導線が動く', async ({ page }) => {
  await page.goto('/');

  // リスト一覧から作成したテスト用リストを開く
  await page.getByText('E2Eスモークテスト用リスト', { exact: true }).click();

  const quickAdd = page.locator('input[placeholder="+ タスクを追加"]');
  await expect(quickAdd).toBeVisible();
  await quickAdd.fill('E2Eテストタスク');
  await quickAdd.press('Enter');

  const row = page.locator('[data-task-row]').filter({ hasText: 'E2Eテストタスク' });
  await expect(row).toBeVisible();

  // 完了させる
  await row.locator('input[type="checkbox"]').click();
  await expect(row.locator('input[type="checkbox"]')).toBeChecked();

  // タスク詳細を開いて削除する
  await row.click();
  await page.locator('button', { hasText: '削除' }).first().click();
  await expect(page.locator('[data-task-row]').filter({ hasText: 'E2Eテストタスク' })).toHaveCount(0);

  // ゴミ箱から復元する
  await page.locator('button[title="ゴミ箱"]').first().click();
  const trashRow = page.locator('text=E2Eテストタスク');
  await expect(trashRow).toBeVisible();
  await page.locator('button', { hasText: '復元' }).first().click();
  await page.locator('button', { hasText: '閉じる' }).first().click();

  await expect(page.locator('[data-task-row]').filter({ hasText: 'E2Eテストタスク' })).toBeVisible();
});

test('カンバン/カレンダー表示に切り替えられる', async ({ page }) => {
  await page.goto('/');
  await page.getByText('E2Eスモークテスト用リスト', { exact: true }).click();

  // 表示方法（リスト/カンバン/カレンダー切替）は改修9回目でポップオーバーの中に集約された。
  // 切替後もポップオーバーは開いたままなので、2回目はトグルボタンを押し直さない
  await page.locator('button[title="表示方法"]').click();
  await page.locator('button[title="カンバン"]').click();
  await expect(page.locator('span').filter({ hasText: '優先度: 高' })).toBeVisible();

  await page.locator('button[title="カレンダー"]').click();
  await expect(page.locator('text=今月')).toBeVisible();
});

// 改修13回目（Claude所感）：モバイル幅の詳細パネル開閉・一覧の表示/非表示切替はよく確認する
// 操作だが、改修前はPlaywrightスクリプトを都度書いて手動検証していた。改修12回目で実際に
// 発生した「開いた瞬間に裏の一覧が消える／閉じてもアニメーションが終わるまで一覧が戻らない」
// という回帰をCIで自動検出できるよう、最終状態（開いたら隠れる・閉じたら戻る）だけでも
// スモークテストに加えておく
test.describe('モバイル幅でのタスク詳細パネル開閉', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('詳細を開くと一覧が隠れ、閉じると一覧が再表示される', async ({ page }) => {
    await page.goto('/');
    // モバイル幅ではサイドバー（リスト一覧）がドロワーに格納されているため、
    // 先にハンバーガーメニューで開く。PC用サイドバーはモバイル幅でも(非表示のまま)DOMに
    // 残っているため、開いたドロワー（nav要素）内のリストに絞って選択する
    await page.locator('button[title="メニュー"]').click();
    await page.getByRole('navigation').getByText('E2Eスモークテスト用リスト', { exact: true }).click();

    // クイック追加は作成直後にそのタスクを自動選択する（onSelectTask）ため、
    // Enter直後から既に詳細パネルが開き一覧が隠れた状態になる
    const quickAdd = page.locator('input[placeholder="+ タスクを追加"]');
    await quickAdd.fill('モバイル表示テスト');
    await quickAdd.press('Enter');

    const row = page.locator('[data-task-row]').filter({ hasText: 'モバイル表示テスト' });
    await expect(row).toBeHidden();

    await page.locator('button', { hasText: '閉じる' }).first().click();
    await expect(row).toBeVisible();
  });
});
