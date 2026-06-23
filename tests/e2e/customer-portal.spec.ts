import { test, expect, type Page } from '@playwright/test';
import crypto from 'crypto';
import { hashPassword } from '../test-utils';
import { isServerAvailable, skipIfOffline } from './helpers';

let serverUp = false;
test.setTimeout(180_000);

interface CustomerPortalSeed {
  tenantId: string;
  tenantCode: string;
  roleId: string;
  userId: string;
  customerId: string;
  email: string;
  password: string;
  domain: string;
  customerName: string;
}

let seed: CustomerPortalSeed | null = null;

test.beforeAll(async () => {
  serverUp = await isServerAvailable();
  if (!serverUp) return;

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const uid = crypto.randomUUID().slice(0, 8).toLowerCase();
  const tenantId = crypto.randomUUID();
  const roleId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const domain = `abc-${uid}.example.com`;
  const email = `employee@${domain}`;
  const password = `ABCPortal${uid}!`;
  const customerName = `ABC Corporate ${uid.toUpperCase()}`;

  seed = {
    tenantId,
    tenantCode: `E2E-ABC-${uid.toUpperCase()}`,
    roleId,
    userId,
    customerId,
    email,
    password,
    domain,
    customerName,
  };

  try {
    await ensureCorporatePortalTables(prisma);
    await ensureSsoTable(prisma);

    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: `AAT Transport E2E ${uid.toUpperCase()}`,
        code: seed.tenantCode,
        plan: 'ENTERPRISE',
        isActive: true,
      },
    });

    await prisma.role.create({
      data: { id: roleId, tenantId, name: 'Tenant Administrator', code: 'TENANT_ADMIN' },
    });

    await prisma.user.create({
      data: {
        id: userId,
        email,
        username: `abc-${uid}`,
        firstName: 'ABC',
        lastName: 'Employee',
        isActive: true,
        updatedAt: new Date(),
      },
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET password_hash = $1 WHERE id = $2`,
      hashPassword(password),
      userId,
    );

    await prisma.userTenant.create({
      data: { id: crypto.randomUUID(), userId, tenantId, roleId, isActive: true },
    });

    await prisma.customer.create({
      data: {
        id: customerId,
        tenantId,
        customerType: 'CORPORATE',
        nameEn: customerName,
        email: `admin@${domain}`,
        status: 'ACTIVE',
      },
    });

    await prisma.$executeRawUnsafe(
      `INSERT INTO customer_domains
         (tenant_id, customer_id, domain, is_verified, verified_at, verification_method, created_by_user_id)
       VALUES ($1, $2, $3, TRUE, NOW(), 'E2E', $4)`,
      tenantId,
      customerId,
      domain,
      userId,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO customer_users
         (tenant_id, customer_id, user_id, role, source, is_active)
       VALUES ($1, $2, $3, 'CUSTOMER_ADMIN', 'E2E', TRUE)`,
      tenantId,
      customerId,
      userId,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenant_sso_configs
         (tenant_id, provider, issuer, client_id, client_secret_encrypted,
          allowed_email_domains, jit_enabled, is_active, created_by_user_id)
       VALUES ($1, 'oidc', 'https://login.example.com/oidc', 'fleet360-e2e-client', $2, $3::jsonb, TRUE, TRUE, $4)`,
      tenantId,
      encryptSecretForTest('secret'),
      JSON.stringify([domain]),
      userId,
    );
  } finally {
    await prisma.$disconnect();
  }
});

test.afterAll(async () => {
  if (!seed) return;
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM auth_login_attempts WHERE tenant_id = $1 OR email LIKE $2`, seed.tenantId, `%@${seed.domain}`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM tenant_sso_configs WHERE tenant_id = $1`, seed.tenantId).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM customer_users WHERE tenant_id = $1`, seed.tenantId).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM customer_domains WHERE tenant_id = $1`, seed.tenantId).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM customers WHERE tenant_id = $1`, seed.tenantId).catch(() => {});
    await prisma.userTenant.deleteMany({ where: { tenantId: seed.tenantId } }).catch(() => {});
    await prisma.role.deleteMany({ where: { tenantId: seed.tenantId } }).catch(() => {});
    await prisma.user.delete({ where: { id: seed.userId } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: seed.tenantId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

test.beforeEach(async ({}, testInfo) => {
  skipIfOffline(serverUp, testInfo);
  expect(seed).not.toBeNull();
});

test('unauthenticated users cannot open the customer portal directly', async ({ page }) => {
  await page.goto('/customer', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login**', { timeout: 15_000 });
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test('password login for an ABC corporate user redirects to the customer portal', async ({ page }) => {
  await loginAsCustomer(page);

  await expect(page.locator('header')).toContainText(seed!.customerName, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Welcome, ABC Employee' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('ADMIN', { exact: true })).toBeVisible({ timeout: 60_000 });
});

test('customer portal renders home, bookings, services, profile, and transport pages', async ({ page }) => {
  await loginAsCustomer(page);

  await expect(page.getByRole('link', { name: 'Bookings' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Services' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible({ timeout: 60_000 });

  await page.getByRole('link', { name: 'Bookings' }).click();
  await page.waitForURL('**/customer/my-bookings', { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'My Bookings' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('No bookings found')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('link', { name: 'Services' }).click();
  await page.waitForURL('**/customer/my-services', { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'My Services' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Corporate Transport Account')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('link', { name: 'Profile' }).click();
  await page.waitForURL('**/customer/profile', { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(seed!.email)).toBeVisible({ timeout: 60_000 });

  await page.goto('/customer/transport', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Corporate Transport' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('No trips scheduled for today')).toBeVisible({ timeout: 60_000 });
});

test('customer-scoped APIs return only the logged-in corporate customer context', async ({ page }) => {
  await loginAsCustomer(page);

  const identity = await page.request.get('/api/customer/identity');
  expect(identity.status()).toBe(200);
  await expect(identity).toBeOK();
  expect(await identity.json()).toMatchObject({
    customer: {
      tenantId: seed!.tenantId,
      customerId: seed!.customerId,
      customerName: seed!.customerName,
      role: 'CUSTOMER_ADMIN',
    },
  });

  const profile = await page.request.get('/api/customer/profile');
  expect(profile.status()).toBe(200);
  expect(await profile.json()).toMatchObject({
    name: 'ABC Employee',
    customerName: seed!.customerName,
    email: seed!.email,
  });

  const services = await page.request.get('/api/customer/services');
  expect(services.status()).toBe(200);
  expect((await services.json()).services[0]).toMatchObject({
    type: 'Corporate Transport Account',
    status: 'active',
  });
});

test('SSO discovery routes ABC users to the customer portal return path', async ({ page }) => {
  let initiateUrl = '';
  await page.route('**/api/auth/sso/initiate**', async (route) => {
    initiateUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'SSO intercepted by E2E' });
  });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_000);
  const ssoToggle = page.locator('button.text-violet-300:has-text("Sign in with SSO")');
  await expect(ssoToggle).toBeVisible({ timeout: 60_000 });
  await ssoToggle.click({ force: true });
  await expect(page.locator('button[type="submit"]:has-text("Continue with SSO")')).toBeVisible({ timeout: 60_000 });
  await fillInput(page.locator('form input[type="email"]'), seed!.email);
  await page.locator('button[type="submit"]:has-text("Continue with SSO")').click();

  await expect.poll(() => initiateUrl, { timeout: 60_000 }).toContain('/api/auth/sso/initiate');
  const url = new URL(initiateUrl);
  expect(url.searchParams.get('email')).toBe(seed!.email);
  expect(url.searchParams.get('returnTo')).toBe('/customer');
});

test('sign out clears the customer session and protects the portal again', async ({ page }) => {
  await loginAsCustomer(page);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login**', { timeout: 60_000 });

  await page.goto('/customer', { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login**', { timeout: 15_000 });
});

async function loginAsCustomer(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('form button[type="submit"]:has-text("Sign in")')).toBeVisible();
  await fillInput(page.locator('form input[type="email"]'), seed!.email);
  await fillInput(page.locator('form input[type="password"]'), seed!.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL('**/customer**', { timeout: 60_000, waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
}

async function fillInput(locator: ReturnType<Page['locator']>, value: string) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await locator.click();
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.fill(value);
  if ((await locator.inputValue()) === value) return;

  await locator.click();
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.pressSequentially(value);
  if ((await locator.inputValue()) === value) return;

  await locator.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(locator).toHaveValue(value);
}

async function ensureCorporatePortalTables(prisma: { $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown> }) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS customer_domains (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tenant_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT TRUE,
      verified_at TIMESTAMPTZ,
      verification_method TEXT,
      created_by_user_id TEXT,
      notes TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS customer_domains_domain_key
      ON customer_domains (LOWER(domain))
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS customer_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tenant_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CUSTOMER_USER',
      source TEXT NOT NULL DEFAULT 'MANUAL',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      invited_by_user_id TEXT,
      last_access_at TIMESTAMPTZ
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS customer_users_tenant_customer_user_key
      ON customer_users (tenant_id, customer_id, user_id)
  `);
}

async function ensureSsoTable(prisma: { $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown> }) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tenant_sso_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'oidc',
      issuer TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret_encrypted TEXT NOT NULL,
      allowed_email_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
      default_role_id TEXT,
      jit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function encryptSecretForTest(plaintext: string): string {
  const raw = process.env.SSO_ENCRYPTION_KEY ?? process.env.SESSION_SECRET ?? 'xl-mobility-dev-secret-change-in-production';
  const key = crypto.createHash('sha256').update(raw).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}
