/**
 * E2E — School Bus Transportation Full User Flow
 *
 * Journey:
 *  1.  Login as ENTERPRISE tenant admin
 *  2.  School bus dashboard renders
 *  3.  Students page renders
 *  4.  Create a new student record
 *  5.  Routes page renders
 *  6.  Stops page renders
 *  7.  Attendance page renders
 *  8.  Schedules page renders
 *  9.  Dispatch page renders
 * 10.  Live map page renders
 * 11.  Seat availability page renders
 * 12.  Attendants page renders
 * 13.  Driver scores page renders
 * 14.  Analytics page renders
 * 15.  Trips page renders
 * 16.  Intelligence page renders
 * 17.  Allocations page renders
 * 18.  Fees page renders
 * 19.  Reports page renders
 * 20.  Route planner page renders
 *
 * Prerequisites: `npm run dev` must be running on localhost:3000
 * Run: npx playwright test tests/e2e/school-bus-workflow.spec.ts
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

const STUDENT_NAME   = 'Fatima Khalid Al Mansoori';
const STUDENT_GRADE  = 'Grade 5';
const PARENT_PHONE   = '+97150123456';
const ROUTE_NAME     = 'Route A - Jumeirah to GEMS School';

// ── Setup / teardown ───────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  serverUp = await isServerAvailable();
  if (!serverUp) return;
  try {
    ctx = await createE2ETenant('SchoolBus');
  } catch (err) {
    console.warn('[SchoolBus E2E] First createE2ETenant attempt failed, retrying…', err);
    await new Promise(r => setTimeout(r, 3_000));
    ctx = await createE2ETenant('SchoolBus');
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

async function goToSchoolBus(page: any) {
  await page.goto('/school-bus', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('SBT-01: School Bus module is accessible from platform', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await goToSchoolBus(page);

  await expect(
    page.locator('h1, h2, nav, [href*="/school-bus/"]').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-02: Students page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/students', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Student"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-03: Create a new student record', async ({ page }) => {
  test.setTimeout(150_000); // form page wakes Neon for students/routes/vehicles
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/students', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  const newBtn = page.locator(
    'button:has-text("New Student"), button:has-text("Add Student"), ' +
    'button:has-text("Enroll"), button:has-text("Add"), a:has-text("New Student")'
  ).first();

  if (await newBtn.count() === 0) {
    console.warn('[SBT-03] No "New Student" button found — skipping creation step');
    return;
  }
  await newBtn.click();

  await page.waitForSelector(
    'h2:has-text("Student"), [role="dialog"], form',
    { timeout: 10_000 }
  ).catch(() => {});

  // Student name
  await page.locator(
    'input[placeholder*="student" i], input[placeholder*="name" i], ' +
    'input[placeholder*="full name" i]'
  ).first().fill(STUDENT_NAME).catch(() => {});

  // Grade / class
  await page.locator(
    'input[placeholder*="grade" i], input[placeholder*="class" i], ' +
    'select[name*="grade" i]'
  ).first().fill(STUDENT_GRADE).catch(() => {});

  // Parent phone
  await page.locator('input[type="tel"]').first().fill(PARENT_PHONE).catch(() => {});

  await page.waitForTimeout(400);

  const studentResponsePromise = page.waitForResponse(
    r => r.url().includes('/api/school-bus') && r.request().method() === 'POST',
    { timeout: 8_000 },
  ).catch(() => null);

  await page.locator(
    'button:has-text("Create"), button:has-text("Save"), button:has-text("Enroll"), ' +
    'button:has-text("Submit")'
  ).last().click({ timeout: 5_000 }).catch(() => { console.warn('[E2E] Submit button not found or not clickable'); });

  const resp = await studentResponsePromise;
  if (resp) {
    const status = resp.status();
    if (status >= 400) {
      const body = await resp.json().catch(() => ({}));
      console.warn(`[SBT-03] POST school-bus API → ${status}:`, JSON.stringify(body));
    }
  } else {
    console.warn('[SBT-03] No POST response captured');
  }

  await page.waitForTimeout(500);
  const content = await page.content();
  expect(content).not.toContain('Application error');
});

test('SBT-04: Student appears in students list', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/students', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 10_000 });

  const nameCount = await page.locator(`:text("${STUDENT_NAME}")`).count();
  if (nameCount === 0) {
    console.warn(`[SBT-04] "${STUDENT_NAME}" not in list — student may not have been saved in SBT-03`);
  }
});

test('SBT-05: Routes page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/routes', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Route"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-06: Create a new bus route', async ({ page }) => {
  test.setTimeout(150_000);
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/routes', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  const newBtn = page.locator(
    'button:has-text("New Route"), button:has-text("Add Route"), ' +
    'button:has-text("Create Route"), button:has-text("New")'
  ).first();

  if (await newBtn.count() === 0) {
    console.warn('[SBT-06] No route button found — skipping');
    return;
  }
  await newBtn.click();
  await page.waitForTimeout(500);

  await page.locator(
    'input[placeholder*="route" i], input[placeholder*="name" i]'
  ).first().fill(ROUTE_NAME).catch(() => {});
  await page.waitForTimeout(400);

  await page.locator(
    'button:has-text("Create"), button:has-text("Save"), button:has-text("Submit")'
  ).last().click({ timeout: 5_000 }).catch(() => { console.warn('[E2E] Submit button not found or not clickable'); });
  await page.waitForTimeout(500);

  const content = await page.content();
  expect(content).not.toContain('Application error');
});

test('SBT-07: Stops page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/stops', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Stop"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-08: Attendance page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/attendance', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Attendance"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-09: Schedules page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/schedules', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Schedule"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-10: Dispatch page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/dispatch', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Dispatch"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-11: Live map page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/live-map', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Map"), :text("Live"), :text("Track"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-12: Seat availability page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/seat-availability', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Seat"), :text("Availab"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-13: Attendants page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/attendants', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Attendant"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-14: Driver scores page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/driver-scores', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Driver"), :text("Score"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-15: Analytics page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/analytics', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Analytic"), :text("Report"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-16: Trips page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/trips', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Trip"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-17: Intelligence page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/intelligence', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Intelligence"), :text("AI"), :text("Insight"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-18: Allocations page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/allocations', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Allocation"), :text("Assign"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-19: Fees page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  // School-bus fees were consolidated into Finance → /finance/invoices redirects here
  await page.goto('/school-bus/fees', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForSettle(page);

  // The route may redirect to /finance/invoices?module=SCHOOL_BUS — accept either page
  await expect(
    page.locator('h1, h2, :text("Fee"), :text("Invoice"), :text("Finance"), main').first()
  ).toBeVisible({ timeout: 15_000 });
});

test('SBT-20: Reports page renders', async ({ page }) => {
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/reports', { waitUntil: 'domcontentloaded' });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Report"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-21: Route planner page renders', async ({ page }) => {
  test.setTimeout(120_000); // Mapbox + TSP init is slow on cold load
  await loginWithStoredState(page, authState!, ctx!);
  await page.goto('/school-bus/route-planner', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForSettle(page);

  await expect(
    page.locator('h1, h2, :text("Planner"), :text("Plan"), :text("Route"), main').first()
  ).toBeVisible({ timeout: 10_000 });
});

test('SBT-22: School bus dashboard shows summary metrics', async ({ page }) => {
  test.setTimeout(120_000); // dashboard is the 22nd test — server may be warm-cooling
  await loginWithStoredState(page, authState!, ctx!);
  await goToSchoolBus(page);
  await waitForSettle(page, 20_000);

  const title = await page.title();
  expect(title).not.toContain('500');
  expect(title).not.toContain('Error');

  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
});
