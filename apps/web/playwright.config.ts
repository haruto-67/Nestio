import { defineConfig } from '@playwright/test';

/**
 * 主要導線のスモークテスト（改修5回目）。ローカルでは既に起動中のdevサーバーを再利用し、
 * CIでは`pnpm dev`相当を新規起動する。better-sqlite3はネイティブモジュールのため
 * CIランナー（Linux x64）でのビルドと、Pi実機（arm64）向けDockerビルドは完全に別物であることに注意
 * （docker/Dockerfile側のビルドとは無関係。CLAUDE.md「ビルド上の注意」参照）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @nestio/api run dev',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @nestio/web run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
      timeout: 60_000,
    },
  ],
});
