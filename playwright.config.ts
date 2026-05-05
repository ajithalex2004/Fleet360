import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',

  // Run each spec file serially so tenant data doesn't collide
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  // Local: 0 retries — retry workers spawn extra logins that overwhelm a stressed
  // dev server, turning a single flaky test into an 8-hour hang.  CI gets 2 retries
  // because runners are fresh and Neon is pre-warmed.
  retries: process.env.CI ? 2 : 0,

  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: 'http://localhost:3000',

    // Capture artefacts on failure for easier debugging
    screenshot: 'only-on-failure',
    video:      'retain-on-failure',
    trace:      'on-first-retry',

    // Generous timeouts for a Next.js app that may cold-start
    actionTimeout:     15_000,
    navigationTimeout: 60_000,   // heavy pages (dispatch/command, route-planner) need >30 s
  },

  // Global timeout per test (generous for full user-flow tests)
  timeout: 90_000,
  expect: {
    timeout: 12_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
