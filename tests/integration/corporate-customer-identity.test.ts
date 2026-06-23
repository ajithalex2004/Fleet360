import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { ensureSsoTable, encryptSecret } from '@/lib/sso';
import { ensureCorporateCustomerIdentityTables, ensureCustomerUserLink } from '@/lib/corporate-customer-identity';
import {
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

let serverAvailable = false;

function routeHeaders(seed: SeedResult) {
  return {
    ...seed.headers,
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': seed.role.code,
  };
}

describe('Corporate customer identity layer', () => {
  let seed: SeedResult;
  const domain = `corp-${Date.now()}.example.com`;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    seed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN', 'TestPassword123!');
    await ensureCorporateCustomerIdentityTables();
    await ensureSsoTable();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenant_sso_configs
         (tenant_id, provider, issuer, client_id, client_secret_encrypted,
          allowed_email_domains, jit_enabled, is_active, created_by_user_id)
       VALUES ($1, 'oidc', 'https://login.example.com/oidc', 'fleet360-test-client', $2, $3::jsonb, TRUE, TRUE, $4)
       ON CONFLICT (tenant_id)
       DO UPDATE SET issuer = EXCLUDED.issuer,
                     client_id = EXCLUDED.client_id,
                     client_secret_encrypted = EXCLUDED.client_secret_encrypted,
                     allowed_email_domains = EXCLUDED.allowed_email_domains,
                     jit_enabled = TRUE,
                     is_active = TRUE,
                     updated_at = NOW()`,
      seed.tenant.id,
      encryptSecret('secret'),
      JSON.stringify([domain]),
      seed.user.id,
    );
  }, 120_000);

  afterAll(async () => {
    if (!seed) return;
    await prisma.$executeRawUnsafe(`DELETE FROM auth_login_attempts WHERE tenant_id = $1 OR email LIKE $2`, seed.tenant.id, `%@${domain}`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM tenant_sso_configs WHERE tenant_id = $1`, seed.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM customer_users WHERE tenant_id = $1`, seed.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM customer_domains WHERE tenant_id = $1`, seed.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM lessees WHERE customer_id IN (SELECT id FROM customers WHERE tenant_id = $1)`, seed.tenant.id).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM customers WHERE tenant_id = $1`, seed.tenant.id).catch(() => {});
    await cleanupTenant(seed.tenant.id);
    await cleanupUser(seed.user.id);
  }, 60_000);

  it('assigns verified domains to a tenant corporate customer and resolves SSO discovery to that customer', async () => {
    if (!serverAvailable) return;

    const create = await makeRequest('POST', '/api/customers', {
      customerType: 'CORPORATE',
      nameEn: 'AAT Corporate Client',
      email: `admin@${domain}`,
      domains: [domain],
    }, routeHeaders(seed));
    expect(create.status).toBe(201);
    const customer = await create.json();
    expect(customer.tenant_id).toBe(seed.tenant.id);
    expect(customer.domains).toContain(domain);

    const domains = await makeRequest('GET', `/api/customers/${customer.id}/domains`, undefined, routeHeaders(seed));
    expect(domains.status).toBe(200);
    const domainBody = await domains.json();
    expect(domainBody.domains.map((row: { domain: string }) => row.domain)).toContain(domain);

    const discovery = await makeRequest('POST', '/api/auth/sso/discover', {
      email: `employee@${domain}`,
    });
    expect(discovery.status).toBe(200);
    const discoveryBody = await discovery.json();
    expect(discoveryBody).toMatchObject({
      found: true,
      ready: true,
      tenant: { id: seed.tenant.id },
      customer: {
        customerId: customer.id,
        customerName: 'AAT Corporate Client',
        domain,
      },
    });

    await ensureCustomerUserLink({
      tenantId: seed.tenant.id,
      customerId: customer.id,
      userId: seed.user.id,
      role: 'CUSTOMER_ADMIN',
      source: 'TEST',
    });

    const login = await makeRequest('POST', '/api/auth/login', {
      email: seed.user.email,
      password: 'TestPassword123!',
      tenantId: seed.tenant.id,
    });
    expect(login.status).toBe(200);
    const loginBody = await login.json();
    expect(loginBody.customer).toMatchObject({
      tenantId: seed.tenant.id,
      customerId: customer.id,
      customerName: 'AAT Corporate Client',
      role: 'CUSTOMER_ADMIN',
    });
  }, 120_000);
});
