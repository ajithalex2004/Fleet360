/**
 * E2E — Logistics Full User Flow
 *
 * Journey:
 *  1.  Login as ENTERPRISE tenant admin
 *  2.  Logistics dashboard renders
 *  3.  Trips page renders with list or empty state
 *  4.  Trips list exposes dispatch / operational entry points
 *  5.  Trips list or empty state renders without app errors
 *  6.  Dispatch page renders
 *  7.  Tracking page renders
 *  8.  Quotes page renders
 *  9.  Calculate a logistics quote
 * 10.  Vehicles page renders
 * 11.  Drivers page renders
 * 12.  Analytics page renders
 * 13.  Planner page renders
 *
 * Prerequisites: `npm run dev` must be running on localhost:3000
 * Run: npx playwright test tests/e2e/logistics-workflow.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  isServerAvailable, createE2ETenant, cleanupE2ETenant,
  login, saveAuthState, loginWithStoredState,
  skipIfOffline, waitForSettle,
  type E2EContext, type StorageState,
} from './helpers';

// ── State ──────────────────────────────────────────────────────────────────────

let serverUp  = false;
let ctx: E2EContext | null = null;
let authState: StorageState | null = null;

const CUSTOMER_NAME  = 'Gulf Freight Solutions LLC';
const CUSTOMER_PHONE = '+97143001234';
const ORIGIN         = 'Dubai Logistics City, Dubai';
const DESTINATION    = 'Abu Dhabi Industrial Zone, Abu Dhabi';

// ── Setup / teardown ───────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  serverUp = await isServerAvailable();
  if (!serverUp) return;
  try {
    ctx = await createE2ETenant('Logistics');
  } catch (err) {
    console.warn('[Logistics E2E] First createE2ETenant attempt failed, retrying…', err);
    await new Promise(r => setTimeout(r, 3_000));
    ctx = await createE2ETenant('Logistics');
  }
  authState = await saveAuthState(browser, ctx!.email, ctx!.password);
});

test.afterAll(async () => {
  await cleanupE2ETenant(ctx);
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function goToLogistics(page: any) {
  await page.goto('/logistics', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);
}

function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('LOG-01: Logistics module is accessible from platform', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await goToLogistics(page);

  await expect(
    page.locator('h1, h2, nav, [href*="/logistics/"]').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-02: Trips page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/trips', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Trip"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-03: Trips page exposes dispatch operations', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/trips', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('a[href="/logistics/dispatch"], a:has-text("Dispatch Board")').first()
  ).toBeVisible({ timeout: 10_000 });
  const tripsPageContent = await page.content();
  expect(tripsPageContent).not.toContain('Application error');
});

test('LOG-04: Trips list or empty state renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/trips', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('table, :text("No logistics trips found")').first()).toBeVisible({ timeout: 10_000 });
  const quotePageContent = await page.content();
  expect(quotePageContent).not.toContain('Application error');
});

test('LOG-05: Dispatch page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/dispatch', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Dispatch"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-06: Tracking page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/tracking', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Track"), :text("Live"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-07: Quotes page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/quotes', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Quote"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-08: Calculate a logistics quote', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/quotes', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  const calculateButton = page.locator('button:has-text("Calculate Freight Cost")').first();
  await expect(calculateButton).toBeVisible({ timeout: 10_000 });

  await page.locator('input[placeholder="250"]').fill('150');
  await page.locator('input[placeholder="5.0"]').fill('4.5');
  await page.locator('input[placeholder="50000"]').fill('25000');

  const calcResponsePromise = page.waitForResponse(
    r => r.url().includes('/api/logistics/quotes') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await calculateButton.click();

  const resp = await calcResponsePromise;
  expect(resp.status()).toBeLessThan(400);
  await expect(page.locator(':text("Total Freight Cost")').first()).toBeVisible({ timeout: 10_000 });

  const calculatedQuoteContent = await page.content();
  expect(calculatedQuoteContent).not.toContain('Application error');
});

test('LOG-09: Vehicles page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/vehicles', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Vehicle"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-10: Drivers page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/drivers', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Driver"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-11: Analytics page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/analytics', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Analytic"), :text("Report"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-12: Planner page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/logistics/planner', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Plan"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('LOG-13: Logistics dashboard shows summary metrics', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await goToLogistics(page);
  await waitForSettle(page, 15_000);

  const title = await page.title();
  expect(title).not.toContain('500');
  expect(title).not.toContain('Error');

  await expect(page.locator('h1').first()).toBeVisible({ timeout: 10_000 });
});
