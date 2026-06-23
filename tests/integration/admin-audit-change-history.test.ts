import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { ensureAdminChangeHistoryTable, recordAdminChange } from '@/lib/admin-change-history';
import { NextRequest } from 'next/server';
import {
  cleanupTenant,
  cleanupUser,
  createTestUser,
  createTestUserTenant,
  isServerRunning,
  makeRequest,
  seedTestTenantFull,
  type SeedResult,
} from '../setup';

let serverAvailable = false;

function routeHeaders(seed: SeedResult, extra: Record<string, string> = {}) {
  return {
    ...seed.headers,
    'x-user-id': seed.user.id,
    'x-tenant-id': seed.tenant.id,
    'x-user-role': seed.role.code,
    'user-agent': 'fleet360-audit-test',
    ...extra,
  };
}

async function latestChange(entityType: string, entityId: string | null, action: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    tenant_id: string | null;
    entity_type: string;
    entity_id: string | null;
    action: string;
    actor_user_id: string | null;
    actor_role: string | null;
    impersonated_by: string | null;
    before_json: unknown;
    after_json: unknown;
    summary: string | null;
  }>>(
    `SELECT tenant_id, entity_type, entity_id, action, actor_user_id, actor_role,
            impersonated_by, before_json, after_json, summary
       FROM admin_change_history
      WHERE entity_type = $1
        AND action = $2
        AND ($3::text IS NULL OR entity_id = $3)
      ORDER BY created_at DESC
      LIMIT 1`,
    entityType,
    action,
    entityId,
  );
  return rows[0] ?? null;
}

async function auditCount(entityType: string, entityId: string | null, action: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count
       FROM audit_logs
      WHERE entity_type = $1
        AND action = $2
        AND ($3::text IS NULL OR entity_id = $3)`,
    entityType,
    action,
    entityId,
  ).catch(() => [{ count: BigInt(0) }]);
  return Number(rows[0]?.count ?? 0);
}

describe('Admin audit and change-history coverage', () => {
  let seed: SeedResult;
  let otherSeed: SeedResult;
  let managedUserId = '';
  let invitationId = '';
  let secretChangeEntityId = '';

  beforeAll(async () => {
    serverAvailable = await isServerRunning();
    if (!serverAvailable) return;

    seed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN');
    otherSeed = await seedTestTenantFull('ENTERPRISE', 'TENANT_ADMIN');
    const managed = await createTestUser();
    managedUserId = managed.id;
    await createTestUserTenant(managed.id, seed.tenant.id, seed.role.id);
  }, 60_000);

  afterAll(async () => {
    if (invitationId) {
      await prisma.$executeRawUnsafe(`DELETE FROM tenant_invitations WHERE id = $1::uuid`, invitationId).catch(() => {});
    }
    if (secretChangeEntityId) {
      await prisma.$executeRawUnsafe(`DELETE FROM admin_change_history WHERE entity_id = $1`, secretChangeEntityId).catch(() => {});
    }
    if (managedUserId) await cleanupUser(managedUserId);
    if (otherSeed) await cleanupTenant(otherSeed.tenant.id).then(() => cleanupUser(otherSeed.user.id));
    if (seed) await cleanupTenant(seed.tenant.id).then(() => cleanupUser(seed.user.id));
  }, 60_000);

  it('records actor, impersonation, before/after, and audit row for user profile updates', async () => {
    if (!serverAvailable) return;

    const res = await makeRequest(
      'PATCH',
      `/api/admin/users/${managedUserId}`,
      { firstName: 'Audited', department: 'Quality' },
      routeHeaders(seed, {
        'x-impersonated-by': 'platform-operator-1',
        'x-forwarded-for': '203.0.113.10',
      }),
    );
    expect(res.status).toBe(200);

    const change = await latestChange('User', managedUserId, 'UPDATE');
    expect(change).toMatchObject({
      tenant_id: seed.tenant.id,
      entity_type: 'User',
      entity_id: managedUserId,
      action: 'UPDATE',
      actor_user_id: seed.user.id,
      actor_role: 'TENANT_ADMIN',
      impersonated_by: 'platform-operator-1',
    });
    expect((change?.before_json as { firstName?: string })?.firstName).toBe('Test');
    expect((change?.after_json as { firstName?: string; department?: string })?.firstName).toBe('Audited');
    expect((change?.after_json as { department?: string })?.department).toBe('Quality');
    expect(await auditCount('User', managedUserId, 'UPDATE')).toBeGreaterThan(0);
  });

  it('records invitation create and revoke lifecycle with before/after summaries', async () => {
    if (!serverAvailable) return;

    const email = `audit-invite-${Date.now()}@test.example.com`;
    const create = await makeRequest(
      'POST',
      `/api/admin/tenants/${seed.tenant.id}/invitations`,
      { email, roleId: seed.role.id },
      routeHeaders(seed),
    );
    expect(create.status).toBe(200);
    const createdBody = await create.json();
    invitationId = createdBody.invitationId;
    expect(invitationId).toBeTruthy();

    const createChange = await latestChange('Invitation', invitationId, 'CREATE');
    expect(createChange).toMatchObject({
      tenant_id: seed.tenant.id,
      entity_type: 'Invitation',
      entity_id: invitationId,
      action: 'CREATE',
      actor_user_id: seed.user.id,
      actor_role: 'TENANT_ADMIN',
    });
    expect(createChange?.before_json).toEqual([]);
    expect((createChange?.after_json as { email?: string; role_id?: string })?.email).toBe(email);
    expect((createChange?.after_json as { role_id?: string })?.role_id).toBe(seed.role.id);
    expect(await auditCount('Invitation', invitationId, 'CREATE')).toBeGreaterThan(0);

    const revoke = await makeRequest(
      'POST',
      `/api/admin/tenants/${seed.tenant.id}/invitations/${invitationId}/revoke`,
      undefined,
      routeHeaders(seed),
    );
    expect(revoke.status).toBe(200);

    const revokeChange = await latestChange('Invitation', invitationId, 'DELETE');
    expect((revokeChange?.before_json as { revoked?: boolean })?.revoked).toBe(false);
    expect((revokeChange?.after_json as { revoked?: boolean })?.revoked).toBe(true);
    expect(revokeChange?.summary).toContain('revoked');
    expect(await auditCount('Invitation', invitationId, 'DELETE')).toBeGreaterThan(0);
  });

  it('exposes filtered change history with pagination and masks secrets', async () => {
    if (!serverAvailable) return;

    await ensureAdminChangeHistoryTable();
    secretChangeEntityId = `secret-settings-${Date.now()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO admin_change_history
         (tenant_id, entity_type, entity_id, action, actor_user_id, actor_role,
          before_json, after_json, summary)
       VALUES ($1, 'PlatformSettings', $2, 'UPDATE', $3, $4, $5::jsonb, $6::jsonb, $7)`,
      seed.tenant.id,
      secretChangeEntityId,
      seed.user.id,
      seed.role.code,
      JSON.stringify({ smtp_password: 'old-secret', nested: { apiSecret: 'old-api-secret' } }),
      JSON.stringify({ smtp_password: 'new-secret', nested: { apiSecret: 'new-api-secret' } }),
      'Rotated SMTP credentials',
    );

    const res = await makeRequest(
      'GET',
      `/api/admin/change-history?tenantId=${seed.tenant.id}&entityType=PlatformSettings&search=Rotated&limit=5&page=1`,
      undefined,
      routeHeaders(seed),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, page: 1, limit: 5 });
    expect(body.total).toBeGreaterThanOrEqual(1);

    const row = body.changes.find((change: { entity_id?: string }) => change.entity_id === secretChangeEntityId);
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain('new-secret');
    expect(JSON.stringify(row)).not.toContain('old-api-secret');
    expect(row.before_json.smtp_password).toBe('********');
    expect(row.after_json.nested.apiSecret).toBe('********');
  });

  it('enforces tenant-admin boundaries on change history reads', async () => {
    if (!serverAvailable) return;

    const forbidden = await makeRequest(
      'GET',
      `/api/admin/change-history?tenantId=${otherSeed.tenant.id}`,
      undefined,
      routeHeaders(seed),
    );
    expect(forbidden.status).toBe(403);

    const scoped = await makeRequest(
      'GET',
      `/api/admin/change-history?tenantId=${seed.tenant.id}&limit=20`,
      undefined,
      routeHeaders(seed),
    );
    expect(scoped.status).toBe(200);
    const body = await scoped.json();
    expect(body.changes.every((change: { tenant_id?: string | null }) => change.tenant_id === seed.tenant.id)).toBe(true);
  });

  it('upgrades legacy change-history schemas before writing approval/audit traces', async () => {
    if (!serverAvailable) return;

    const legacyTable = `admin_change_history_legacy_${Date.now()}`;
    const migratedEntityId = `legacy-upgrade-${Date.now()}`;

    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE admin_change_history RENAME TO ${legacyTable}`);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE admin_change_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id TEXT,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          action TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await recordAdminChange({
        req: new NextRequest('http://localhost/api/admin/approvals/test', {
          headers: routeHeaders(seed, { 'x-impersonated-by': 'legacy-schema-test' }),
        }),
        ctx: {
          userId: seed.user.id,
          tenantId: seed.tenant.id,
          role: seed.role.code,
          isSuperAdmin: seed.role.code === 'SUPER_ADMIN',
          isTenantAdmin: seed.role.code === 'TENANT_ADMIN',
        },
        tenantId: seed.tenant.id,
        entityType: 'AdminApprovalRequest',
        entityId: migratedEntityId,
        action: 'APPROVE',
        before: { status: 'PENDING' },
        after: { status: 'APPROVED' },
        summary: 'Legacy schema upgrade test',
        sourceModule: 'leasing',
        sourceEntityType: 'LeaseContract',
        sourceEntityId: 'legacy-contract-1',
        riskSeverity: 'high',
      });

      const rows = await prisma.$queryRawUnsafe<Array<{
        entity_id: string | null;
        impersonated_by: string | null;
        source_module: string | null;
        source_entity_type: string | null;
        source_entity_id: string | null;
        risk_severity: string | null;
      }>>(
        `SELECT entity_id, impersonated_by, source_module, source_entity_type, source_entity_id, risk_severity
           FROM admin_change_history
          WHERE entity_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        migratedEntityId,
      );
      expect(rows[0]).toMatchObject({
        entity_id: migratedEntityId,
        impersonated_by: 'legacy-schema-test',
        source_module: 'leasing',
        source_entity_type: 'LeaseContract',
        source_entity_id: 'legacy-contract-1',
        risk_severity: 'high',
      });
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS admin_change_history`).catch(() => {});
      await prisma.$executeRawUnsafe(`ALTER TABLE ${legacyTable} RENAME TO admin_change_history`).catch(() => {});
      await ensureAdminChangeHistoryTable();
    }
  });
});
