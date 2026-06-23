import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { ensureSsoTable, encryptSecret } from '@/lib/sso';
import {
  cleanupTenant,
  createTestTenant,
  isServerRunning,
  makeRequest,
  type TestTenant,
} from '../setup';

let serverAvailable = false;

describe('SSO readiness and discovery', () => {
  let tenant: TestTenant;
  const domain = `sso-${Date.now()}.example.com`;

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    tenant = await createTestTenant({ plan: 'ENTERPRISE', domain });
    await ensureSsoTable();
    await prisma.$executeRawUnsafe(
      `INSERT INTO tenant_sso_configs
         (tenant_id, provider, issuer, client_id, client_secret_encrypted,
          allowed_email_domains, jit_enabled, is_active, created_by_user_id)
       VALUES ($1, 'oidc', 'https://login.example.com/oidc', 'fleet360-test-client', $2, $3::jsonb, TRUE, TRUE, 'integration-test')`,
      tenant.id,
      encryptSecret('secret'),
      JSON.stringify([domain]),
    );
  }, 120_000);

  afterAll(async () => {
    if (tenant) {
      await prisma.$executeRawUnsafe(`DELETE FROM auth_login_attempts WHERE tenant_id = $1 OR email LIKE $2`, tenant.id, `%@${domain}`).catch(() => {});
      await prisma.$executeRawUnsafe(`DELETE FROM tenant_sso_configs WHERE tenant_id = $1`, tenant.id).catch(() => {});
      await cleanupTenant(tenant.id);
    }
  }, 60_000);

  it('discovers configured tenant SSO before redirecting to the provider', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest('POST', '/api/auth/sso/discover', {
      email: `alex@${domain}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      found: true,
      ready: true,
      reason: 'ready',
      domain,
      tenant: { id: tenant.id },
      readiness: { status: 'ready' },
    });

    const attempts = await prisma.$queryRawUnsafe<Array<{ success: boolean; failure_reason: string | null }>>(
      `SELECT success, failure_reason
         FROM auth_login_attempts
        WHERE email = $1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      `alex@${domain}`,
    );
    expect(attempts[0]).toMatchObject({ success: true, failure_reason: null });
  }, 60_000);

  it('returns a clear password-login fallback when no SSO config owns the domain', async () => {
    if (!serverAvailable) return;

    const email = `missing-${Date.now()}@no-sso.example.com`;
    const res = await makeRequest('POST', '/api/auth/sso/discover', { email });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      found: false,
      reason: 'not-configured',
      domain: 'no-sso.example.com',
    });

    const attempts = await prisma.$queryRawUnsafe<Array<{ success: boolean; failure_reason: string | null }>>(
      `SELECT success, failure_reason
         FROM auth_login_attempts
        WHERE email = $1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      email,
    );
    expect(attempts[0]).toMatchObject({ success: false, failure_reason: 'SSO_DISCOVERY_NOT_CONFIGURED' });
  }, 60_000);
});
