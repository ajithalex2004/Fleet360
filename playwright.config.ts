import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';
import { guardTestDatabases } from './tests/db-guard';

const envTestPath = path.resolve(__dirname, '.env.test');
const testEnv: Record<string, string> = fs.existsSync(envTestPath)
  ? dotenv.parse(fs.readFileSync(envTestPath, 'utf8'))
  : {};

const guardedEnv: Record<string, string | undefined> = {
  ...process.env,
  ...testEnv,
  DATABASE_URL: testEnv.DATABASE_URL || process.env.DATABASE_URL || 'postgresql://fleet360_app@127.0.0.1:5433/fleet360_e2e_test',
  DIRECT_URL: testEnv.DIRECT_URL || process.env.DIRECT_URL || 'postgresql://postgres@127.0.0.1:5433/fleet360_e2e_test',
  TEST_DATABASE_URL: testEnv.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgresql://fleet360_app@127.0.0.1:5433/fleet360_e2e_test',
};
guardTestDatabases(guardedEnv);

const DEFAULT_BASE_URL = 'http://localhost:3000';
const rawBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = rawBaseUrl || DEFAULT_BASE_URL;

function isLocalTargetUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (
      normalized === 'localhost' ||
      normalized === '127.0.0.1' ||
      normalized === '::1' ||
      normalized.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

// Only start the local Next.js server when targeting localhost. Remote targets
// (such as CI Gate 2 pointing PLAYWRIGHT_BASE_URL at a deployed environment)
// run directly against the target without building or launching `next start`.
const isRemoteBaseUrl = Boolean(rawBaseUrl) && !isLocalTargetUrl(baseURL);

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
    baseURL,

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

  ...(isRemoteBaseUrl
    ? {}
    : {
        webServer: {
          command: process.env.PLAYWRIGHT_SERVER_CMD || 'npm run start',
          url: 'http://127.0.0.1:3000/api/health',
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            DATABASE_URL: guardedEnv.DATABASE_URL || 'postgresql://fleet360_app@127.0.0.1:5433/fleet360_e2e_test',
            DIRECT_URL: testEnv.DIRECT_URL || guardedEnv.DIRECT_URL || 'postgresql://postgres@127.0.0.1:5433/fleet360_e2e_test',
            RUNTIME_DIRECT_DATABASE_URL: guardedEnv.DATABASE_URL || 'postgresql://fleet360_app@127.0.0.1:5433/fleet360_e2e_test',
            TEST_DATABASE_URL: guardedEnv.TEST_DATABASE_URL || 'postgresql://fleet360_app@127.0.0.1:5433/fleet360_e2e_test',
            DISABLE_JOB_SCHEDULER: 'true',
            FLEET360_SKIP_DB_PREWARM: 'true',
            UPSTASH_REDIS_REST_URL: 'disabled',
            UPSTASH_REDIS_REST_TOKEN: 'disabled',
            SESSION_SECRET: testEnv.SESSION_SECRET || process.env.SESSION_SECRET || 'test-secret-key-for-testing-only-32chars',
            SETUP_SECRET: testEnv.SETUP_SECRET || process.env.SETUP_SECRET || 'test-setup-secret',
            WHATSAPP_APP_SECRET: testEnv.WHATSAPP_APP_SECRET || process.env.WHATSAPP_APP_SECRET || 'test_whatsapp_secret_fleet360_2026',
            TWILIO_AUTH_TOKEN: testEnv.TWILIO_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || 'test_twilio_auth_token_fleet360_2026',
            VAPID_PUBLIC_KEY: testEnv.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || 'BMPvHsGbBroOZVihZzCWbA_w2T86MRawXSnCcc2llbfSjwh48dsSLYp9LzNJ83RLWV-QmXvQaZykkc3ePdhqVmE',
            VAPID_PRIVATE_KEY: testEnv.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || '04xFEgBzum9jbZhGKJd8-HXhCF_H6JlrLvmPLcySwzk',
            VAPID_SUBJECT: testEnv.VAPID_SUBJECT || process.env.VAPID_SUBJECT || 'mailto:admin@fleet360.com',
          },
        },
      }),
});
