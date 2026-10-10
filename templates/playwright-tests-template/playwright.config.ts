import { defineConfig } from '@playwright/test';

/**
 * API test configuration for __PROJECT_NAME__.
 * Points at a locally running instance by default (./gradlew bootRun on :8080).
 * Override with BASE_URL=http://host:port npx playwright test
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // tasks share one Postgres instance; keep sequential to avoid cross-test noise
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,

  reporter: [
    ['list'], // live pass/fail output in the terminal as tests run
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/results.xml' }],
  ],

  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8080',
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    trace: 'on', // captures every request/response (headers, body, timing) viewable in the HTML report
  },
});
