import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  use: {
    baseURL: process.env.TEST_URL || 'https://sheeets.vercel.app',
    viewport: { width: 1280, height: 720 },
  },
  reporter: 'list',
});
