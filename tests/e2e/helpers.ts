/**
 * Shared E2E test helpers for Smart Mobility Platform
 *
 * Provides:
 *  - serverAvailable()   – probe localhost:3000 before running tests
 *  - createE2ETenant()   – create an isolated tenant + admin user via Prisma
 *  - cleanupE2ETenant()  – tear down after tests
 *  - login()             – browser-level login helper
 *  - waitForToast()      – wait for success / error feedback
 *  - skipIfOffline()     – per-test skip hook when server is unreachable
 */

import { type Page, type Browser, type Locator, type TestInfo } from '@playwright/test';
import { hashPassword } from '../test-utils';

async function retryTestDb<T>(
  label: string,
  operation: () => Promise<T>,
  attempts = 3,
  delayMs = 750,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      console.warn(`[E2E][DB] ${label} failed on attempt ${attempt}/${attempts}; retrying...`);
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

// ── Auth state type (matches Playwright storageState shape) ────────────────────
export interface StorageState {
  cookies: Array<{
    name: string; value: string; domain: string; path: string;
    expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

// ── Server probe ───────────────────────────────────────────────────────────────

export async function isServerAvailable(): Promise<boolean> {
  const urls = ['http://127.0.0.1:3000/api/health', 'http://localhost:3000/api/health'];
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 3_000));
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) {
          console.log(`[E2E] Server reachable at ${url} (status ${res.status})`);
          return true;
        }
      } catch (err) {
        console.log(`[E2E] Server not reachable at ${url}: ${err}`);
      }
    }
  }
  return false;
}

// ── Tenant + user factory ──────────────────────────────────────────────────────

export interface E2EContext {
  tenantId:   string;
  tenantCode: string;
  userId:     string;
  email:      string;
  password:   string;
}

/**
 * Creates a fresh isolated tenant and an ENTERPRISE TENANT_ADMIN user.
 * Call in test.beforeAll(); pass the result to cleanupE2ETenant in afterAll.
 */
export async function createE2ETenant(
  label: string,
  plan: 'TRIAL' | 'PROFESSIONAL' | 'ENTERPRISE' = 'ENTERPRISE',
): Promise<E2EContext> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma  = new PrismaClient();
  const crypto  = await import('crypto');

  const uid      = crypto.randomUUID().slice(0, 8).toUpperCase();
  const tenantId = crypto.randomUUID();
  const userId   = crypto.randomUUID();
  const email    = `e2e-${label.toLowerCase().replace(/\s+/g, '-')}-${uid.toLowerCase()}@test.example.com`;
  const password = `E2EPass${uid}!`;
  const code     = `E2E-${label.toUpperCase().replace(/\s+/g, '-').slice(0, 10)}-${uid}`;

  try {
    await retryTestDb('create tenant', () => prisma.tenant.create({
      data: { id: tenantId, name: `E2E ${label} ${uid}`, code, plan, isActive: true },
    }));

    await retryTestDb('create user', () => prisma.user.create({
      data: {
        id: userId, email, username: `e2e-${uid.toLowerCase()}`,
        firstName: label, lastName: 'E2E', isActive: true, updatedAt: new Date(),
      },
    }));

    await retryTestDb('set user password hash', () => prisma.$executeRawUnsafe(
      `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
      hashPassword(password), userId,
    ));

    const roleId = crypto.randomUUID();
    await retryTestDb('create role', () => prisma.role.create({
      data: { id: roleId, tenantId, name: 'Tenant Administrator', code: 'TENANT_ADMIN' },
    }));
    await retryTestDb('create user tenant link', () => prisma.userTenant.create({
      data: { id: crypto.randomUUID(), userId, tenantId, roleId, isActive: true },
    }));

    return { tenantId, tenantCode: code, userId, email, password };
  } finally {
    await prisma.$disconnect();
  }
}

/** Tears down everything created by createE2ETenant (and any raw rows scoped to that tenant). */
export async function cleanupE2ETenant(ctx: E2EContext | null): Promise<void> {
  if (!ctx) return;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    // Raw rows created by tests (finance tables, etc.)
    await retryTestDb('cleanup raw tenant rows', async () => {
      await prisma.$executeRawUnsafe(`DELETE FROM finance_invoices WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM finance_expenses WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM auth_sessions WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM auth_login_attempts WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM admin_mfa_policies WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM admin_approval_requests WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM tenant_invitations WHERE tenant_id = $1`, ctx.tenantId).catch(() => {});
    });

    // Auth rows
    await retryTestDb('cleanup auth tenant rows', async () => {
      await prisma.userTenant.deleteMany({ where: { tenantId: ctx.tenantId } });
      await prisma.role.deleteMany({ where: { tenantId: ctx.tenantId } });
      await prisma.user.delete({ where: { id: ctx.userId } }).catch(() => {});
      await prisma.tenant.delete({ where: { id: ctx.tenantId } }).catch(() => {});
    });
  } finally {
    await prisma.$disconnect();
  }
}

// ── Browser helpers ────────────────────────────────────────────────────────────

/** Fills the login form and waits for redirect to /platform.
 *  LOGIN_TIMEOUT is 60 s to absorb Neon cold-starts after tenant creation. */
const LOGIN_TIMEOUT = 60_000;
async function fillLoginInput(input: Locator, value: string): Promise<void> {
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(value);
  if ((await input.inputValue()) === value) return;

  await input.click();
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await input.pressSequentially(value);
  if ((await input.inputValue()) === value) return;

  await input.evaluate((el, nextValue) => {
    const inputEl = el as HTMLInputElement;
    inputEl.value = nextValue;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const emailInput = page.locator('form input[type="email"]').first();
  const passwordInput = page.locator('form input[type="password"]').first();
  await fillLoginInput(emailInput, email);
  await fillLoginInput(passwordInput, password);
  if ((await emailInput.inputValue()) !== email || (await passwordInput.inputValue()) !== password) {
    throw new Error('Login form did not retain entered credentials before submit');
  }
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL('**/platform**', { timeout: LOGIN_TIMEOUT, waitUntil: 'domcontentloaded' });
}

/**
 * Login once via a dedicated browser context, capture the resulting cookies,
 * and return the storage state.  Call in test.beforeAll({ browser }) so the
 * Neon credential query only runs ONCE per spec file regardless of test count.
 *
 * Usage in a spec:
 *   let authState: StorageState | null = null;
 *   test.beforeAll(async ({ browser }) => {
 *     // ... createE2ETenant ...
 *     authState = await saveAuthState(browser, ctx!.email, ctx!.password);
 *   });
 */
export async function saveAuthState(
  browser: Browser,
  email: string,
  password: string,
  maxAttempts = 3,
): Promise<StorageState> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const context = await browser.newContext();
    const page    = await context.newPage();
    try {
      await login(page, email, password);
      const state = await context.storageState() as StorageState;
      await context.close();
      return state;
    } catch (err) {
      lastErr = err;
      console.warn(`[E2E] saveAuthState attempt ${attempt}/${maxAttempts} failed:`, err);
      await context.close().catch(() => {});
      if (attempt < maxAttempts) {
        // Give Neon a moment to wake before retrying
        await new Promise(r => setTimeout(r, 6_000 * attempt));
      }
    }
  }
  throw lastErr;
}

/**
 * Restore an auth session captured by saveAuthState into the current page's
 * context and navigate directly to /platform — no credential form, no DB hit.
 *
 * Falls back to a full login() call if the stored state is invalid (redirected
 * back to /login).
 */
export async function loginWithStoredState(
  page: Page,
  state: StorageState,
  ctx: E2EContext,
): Promise<void> {
  // Inject all cookies from the saved session
  await page.context().addCookies(state.cookies);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ userId, tenantId }) => {
    localStorage.setItem('xl_mobility_session', JSON.stringify({ userId, tenantId, customerId: null }));
  }, { userId: ctx.userId, tenantId: ctx.tenantId });
  // Navigate straight to the authenticated area
  await page.goto('/platform', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
  // If NextAuth rejected the session cookie (e.g. DB rolled), fall back
  const signInRequired = await page
    .locator(':text("Sign in to continue"), :text("SIGN IN REQUIRED")')
    .first()
    .isVisible({ timeout: 1_000 })
    .catch(() => false);
  if (page.url().includes('/login') || signInRequired) {
    console.warn('[E2E] Stored auth state rejected — falling back to full login');
    await login(page, ctx.email, ctx.password);
  }
}

/** Navigate to a module from the platform page. */
export async function goToModule(page: Page, href: string): Promise<void> {
  await page.goto(href);
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
}

/**
 * Wait for any toast / alert / success banner.
 * Matches common patterns: toast, alert[role], .success, text containing keyword.
 */
export async function waitForFeedback(
  page: Page,
  type: 'success' | 'error' = 'success',
  timeoutMs = 10_000,
): Promise<void> {
  const keywords = type === 'success'
    ? ['success', 'created', 'saved', 'updated', 'recorded', 'submitted', 'added']
    : ['error', 'failed', 'invalid', 'required'];

  const selector = [
    '[role="alert"]',
    '[role="status"]',
    '.toast',
    '.notification',
    '[data-testid*="toast"]',
    '[data-testid*="alert"]',
    ...keywords.map(k => `*:has-text("${k[0].toUpperCase() + k.slice(1)}")`),
  ].join(', ');

  await page.locator(selector).first().waitFor({ state: 'visible', timeout: timeoutMs })
    .catch(() => { /* some UIs don't show toasts for every action */ });
}

/** Returns a locator for the first visible button matching any of the given texts. */
export function findButton(page: Page, ...texts: string[]) {
  return page.locator(texts.map(t => `button:has-text("${t}")`).join(', ')).first();
}

/** Returns a locator for the first visible link matching any of the given texts. */
export function findLink(page: Page, ...texts: string[]) {
  return page.locator(texts.map(t => `a:has-text("${t}")`).join(', ')).first();
}

/** Fail fast if the dev server is not reachable so skips cannot mask regressions. */
export function skipIfOffline(serverUp: boolean, testInfo: TestInfo): void {
  if (!serverUp) {
    throw new Error(`Dev server health check failed for ${testInfo.title}. Start Fleet360 on http://localhost:3000 before running E2E tests.`);
  }
}

/**
 * Wait until the page settles after a form submission.
 * Waits for network idle and any loading spinners to disappear.
 */
export async function waitForSettle(page: Page, timeoutMs = 15_000): Promise<void> {
  // 'load' waits for the main document — reliable and fast.
  // 'networkidle' is too strict: dashboards with polling / websockets never reach idle.
  await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {});
  // Best-effort networkidle with an 8 s cap — silently skip if it never settles.
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 8_000) }).catch(() => {});
  // Wait for common loading indicators to disappear
  await page.locator('.animate-spin, [data-loading="true"], [aria-busy="true"]')
    .first()
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => {}); // OK if none present
}

/** Fill a select by value or visible text, handling both <select> and custom dropdowns. */
export async function selectOption(page: Page, selector: string, value: string): Promise<void> {
  const el = page.locator(selector).first();
  const tag = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => 'div');
  if (tag === 'select') {
    await el.selectOption({ label: value }).catch(() => el.selectOption(value));
  } else {
    // Custom dropdown: click to open, then click the option
    await el.click();
    await page.locator(`[role="option"]:has-text("${value}"), li:has-text("${value}")`).first().click();
  }
}
