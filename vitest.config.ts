import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { setupFiles: ['./vitest.setup.ts'], include: ['packages/*/src/**/*.test.ts'], exclude: ['**/node_modules/**', '**/*.release.test.ts'] },
});
