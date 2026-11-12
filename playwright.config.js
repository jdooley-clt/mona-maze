import { defineConfig } from '@playwright/test';

const port = process.env.CABINET_PORT ?? '4261';
export default defineConfig({
  testDir: './tests/cabinet',
  testMatch: ['compatibility.spec.js', 'accessibility.spec.js'],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  // Local runs surface flakes immediately; CI retries only a failed test and then reruns are explicit.
  retries: process.env.CI ? 2 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    // reducedMotion is a browser-context option, not a test option, so it only takes effect from here;
    // it turns the page's transitions off so the accessibility audits never sample a mid-transition colour.
    contextOptions: { reducedMotion: 'reduce' },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run cabinet:serve',
    url: `http://127.0.0.1:${port}/__cabinet_health`,
    reuseExistingServer: false,
  },
});
