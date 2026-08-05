import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    // e2e/はPlaywright専用（test:e2e）。vitestのデフォルトglobが*.spec.tsも拾ってしまうため除外する
    exclude: ['**/node_modules/**', '**/e2e/**'],
  },
});
