import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/tmp/firstpoint-browsers';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 35000,
  expect: { timeout: 8000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
        (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--use-fake-device-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'OPENAI_API_KEY= FIRSTPOINT_OPENAI_KEY= FIRSTPOINT_ALLOW_LOCAL=true FIRSTPOINT_STORAGE=local FIRSTPOINT_DB_PATH=.data/e2e.sqlite npm run start -- --port 3100',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
