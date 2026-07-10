import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  outputDir: '/tmp/sobrew-playwright-results',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium-320', use: { viewport: { width: 320, height: 720 } } },
    { name: 'chromium-390', use: { viewport: { width: 390, height: 844 } } },
    { name: 'chromium-768', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'chromium-1440', use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
