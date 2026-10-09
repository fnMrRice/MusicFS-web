import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 60_000, expect: { timeout: 15_000 }, workers: 1, fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]], use: { channel: 'msedge', headless: true, viewport: { width: 1200, height: 900 }, trace: 'off', launchOptions: { timeout: 15_000 }, actionTimeout: 15_000, navigationTimeout: 15_000 },
});
