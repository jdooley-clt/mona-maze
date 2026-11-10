import { defineConfig } from '@playwright/test';
import candidateConfig from './playwright.config.js';

export default defineConfig({
  testDir: './tests/cabinet',
  testMatch: 'live.spec.js',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: `test-results/live-${process.env.SMOKE_ATTEMPT ?? '1'}`,
  use: { ...candidateConfig.use, baseURL: 'https://jdooley-clt.github.io' },
});
