import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: { channel: 'msedge', locale: 'en-US', viewport: { width: 1400, height: 900 } },
});
