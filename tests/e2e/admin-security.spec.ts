import { test, expect } from '@playwright/test';
import {
  cleanupE2ETenant,
  createE2ETenant,
  isServerAvailable,
  skipIfOffline,
  waitForSettle,
  type E2EContext,
} from './helpers';

let serverUp = false;
let ctx: E2EContext | null = null;

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;
  ctx = await createE2ETenant('Admin Security');
});

test.afterAll(async () => {
  await cleanupE2ETenant(ctx);
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

test('ADM-SEC-01: Security dashboard renders MFA posture and recent sessions', async ({ page }) => {
  test.setTimeout(90_000);
  await page.request.post('/api/auth/login', {
    data: { email: ctx!.email, password: 'WrongPassword123!', tenantId: ctx!.tenantId },
    timeout: 60_000,
  });
  const loginRes = await page.request.post('/api/auth/login', {
    data: { email: ctx!.email, password: ctx!.password, tenantId: ctx!.tenantId },
    timeout: 60_000,
  });
  expect(loginRes.ok()).toBeTruthy();
  await page.goto('/admin/security', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page, 30_000);

  await expect(page.getByRole('heading', { name: /Security Dashboard/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('MFA Enforcement')).toBeVisible();
  await expect(page.getByText('Recent Active Sessions')).toBeVisible();
  await expect(page.getByText('Failed Login & Account Lockout Review')).toBeVisible();
  await expect(page.getByText('MFA Coverage', { exact: true })).toBeVisible();
  await expect(page.getByText('Failed Logins', { exact: true })).toBeVisible();

  const sessionEvidence = page.locator('tbody tr').first().or(page.getByText('No registered sessions yet.')).first();
  await expect(sessionEvidence).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(ctx!.email.toLowerCase()).first()).toBeVisible({ timeout: 20_000 });
});
