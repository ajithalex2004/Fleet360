import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import {
  cleanupTenant,
  cleanupUser,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

const MASKED_SECRET = '********';

let serverAvailable = false;
let seed: SeedResult;
let integrationType = '';

describe('Admin settings, notifications, and integrations', () => {
  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;
    seed = await seedTestTenantFull('ENTERPRISE', 'SUPER_ADMIN');
    integrationType = `WEBHOOK_E2E_${Date.now()}`;
  });

  afterAll(async () => {
    if (integrationType) {
      await prisma.integrationConfig.deleteMany({ where: { type: integrationType } }).catch(() => {});
    }
    await prisma.$executeRawUnsafe(`DELETE FROM platform_settings WHERE key IN ('smtp_password','email_api_key','sms_auth_token','e2e_settings_key')`).catch(() => {});
    if (seed) {
      await cleanupTenant(seed.tenant.id);
      await cleanupUser(seed.user.id);
    }
  }, 30_000);

  it('requires authentication for platform settings and test-channel APIs', async () => {
    if (!serverAvailable) return;

    const settingsRes = await makeRequest('GET', '/api/admin/platform-settings');
    const testRes = await makeRequest('POST', '/api/admin/test-channel', { channel: 'email', settings: {} });

    expect(settingsRes.status).toBe(401);
    expect(testRes.status).toBe(401);
  });

  it('masks platform setting secrets on read', async () => {
    if (!serverAvailable) return;

    await makeRequest('GET', '/api/admin/platform-settings', undefined, seed.headers);
    await prisma.$executeRawUnsafe(`
      INSERT INTO platform_settings (key, value, updated_at)
      VALUES ('smtp_password', 'super-secret-smtp', NOW())
      ON CONFLICT (key) DO UPDATE SET value = 'super-secret-smtp', updated_at = NOW()
    `);

    const res = await makeRequest('GET', '/api/admin/platform-settings', undefined, seed.headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.smtp_password).toBe(MASKED_SECRET);
    expect(JSON.stringify(body)).not.toContain('super-secret-smtp');
  }, 120_000);

  it('queues platform settings mutations for approval with masked before/after data', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'PATCH',
      '/api/admin/platform-settings',
      { smtp_password: MASKED_SECRET, e2e_settings_key: 'queued-value' },
      seed.headers,
    );

    expect(res.status).toBe(428);
    const body = await res.json();
    expect(body.approvalRequest?.id).toBeTruthy();

    const rows = await prisma.$queryRawUnsafe<Array<{ payload_json: unknown }>>(
      `SELECT payload_json
         FROM admin_approval_requests
        WHERE id = $1::uuid
        LIMIT 1`,
      body.approvalRequest.id,
    );
    const payload = JSON.stringify(rows[0]?.payload_json ?? {});
    expect(payload).not.toContain('super-secret-smtp');
  }, 120_000);

  it('masks integration secrets and approval-gates integration changes', async () => {
    if (!serverAvailable) return;

    await prisma.integrationConfig.create({
      data: {
        id: crypto.randomUUID(),
        type: integrationType,
        provider: 'Custom',
        host: 'https://example.test/webhook',
        apiKey: 'live-api-key',
        apiSecret: 'live-api-secret',
        isEnabled: true,
        updatedAt: new Date(),
      },
    });

    const listRes = await makeRequest('GET', '/api/integration-configs', undefined, seed.headers);
    expect(listRes.status).toBe(200);
    const configs = await listRes.json();
    const config = configs.find((row: Record<string, unknown>) => row.type === integrationType);
    expect(config.apiKey).toBe(MASKED_SECRET);
    expect(config.apiSecret).toBe(MASKED_SECRET);
    expect(JSON.stringify(config)).not.toContain('live-api-key');

    const updateRes = await makeRequest(
      'POST',
      '/api/integration-configs',
      { type: integrationType, provider: 'Custom', host: 'https://example.test/v2', apiKey: MASKED_SECRET },
      seed.headers,
    );
    expect(updateRes.status).toBe(428);
    const queued = await updateRes.json();
    expect(queued.approvalRequest?.id).toBeTruthy();
  }, 120_000);
});
