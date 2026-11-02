import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/src/**/*.release.test.ts'], testTimeout: 180_000, hookTimeout: 300_000 },
});
