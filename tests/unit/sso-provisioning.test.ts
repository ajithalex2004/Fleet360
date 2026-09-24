/**
 * tests/unit/sso-provisioning.test.ts
 *
 * pickProvisioningRole() — the role an SSO sign-in grants when it creates a
 * tenant membership. It used to fall back to the tenant's TENANT_ADMIN role
 * (then to any tenant role) when no SSO default role was configured.
 */
import { describe, it, expect } from 'vitest';
import { pickProvisioningRole, type RoleFinder } from '@/lib/sso-provisioning';

const TENANT = 'tenant-a';

interface Row { id: string; code: string; tenantId: string | null }

/** A tiny in-memory stand-in for prisma.role.findFirst over `rows`. */
function finder(rows: Row[]): RoleFinder & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const fn = (async (where: Record<string, unknown>) => {
    calls.push(where);
    const match = rows.find((r) => {
      if ('id' in where && r.id !== where.id) return false;
      if (typeof where.code === 'string' && r.code !== where.code) return false;
      const code = where.code as { not?: string } | undefined;
      if (code && typeof code === 'object' && r.code === code.not) return false;
      if ('tenantId' in where && r.tenantId !== where.tenantId) return false;
      const or = where.OR as Array<{ tenantId: string | null }> | undefined;
      if (or && !or.some((c) => c.tenantId === r.tenantId)) return false;
      return true;
    });
    return match ? { id: match.id, code: match.code } : null;
  }) as RoleFinder & { calls: Record<string, unknown>[] };
  fn.calls = calls;
  return fn;
}

const PLATFORM_VIEWER = { id: 'sys-viewer', code: 'VIEWER', tenantId: null };
const PLATFORM_SUPER = { id: 'sys-super', code: 'SUPER_ADMIN', tenantId: null };
const TENANT_ADMIN = { id: 't-admin', code: 'TENANT_ADMIN', tenantId: TENANT };
const TENANT_VIEWER = { id: 't-viewer', code: 'VIEWER', tenantId: TENANT };
const TENANT_DISPATCH = { id: 't-dispatch', code: 'DISPATCHER', tenantId: TENANT };

describe('pickProvisioningRole', () => {
  it('uses the configured SSO default role', async () => {
    const role = await pickProvisioningRole(TENANT, 't-dispatch', finder([TENANT_DISPATCH, TENANT_ADMIN, PLATFORM_VIEWER]));
    expect(role).toEqual({ id: 't-dispatch', code: 'DISPATCHER' });
  });

  it('falls back to VIEWER, not TENANT_ADMIN, when no default is configured', async () => {
    const role = await pickProvisioningRole(TENANT, null, finder([TENANT_ADMIN, TENANT_DISPATCH, PLATFORM_VIEWER]));
    expect(role).toEqual({ id: 'sys-viewer', code: 'VIEWER' });
  });

  it("prefers the tenant's own VIEWER role over the platform one", async () => {
    const role = await pickProvisioningRole(TENANT, null, finder([PLATFORM_VIEWER, TENANT_VIEWER, TENANT_ADMIN]));
    expect(role).toEqual({ id: 't-viewer', code: 'VIEWER' });
  });

  it('falls back to VIEWER when the configured role no longer exists', async () => {
    const role = await pickProvisioningRole(TENANT, 'deleted-role', finder([TENANT_ADMIN, PLATFORM_VIEWER]));
    expect(role?.code).toBe('VIEWER');
  });

  it('ignores a configured SUPER_ADMIN default', async () => {
    const role = await pickProvisioningRole(TENANT, 'sys-super', finder([PLATFORM_SUPER, PLATFORM_VIEWER]));
    expect(role?.code).toBe('VIEWER');
  });

  it("ignores a configured default that belongs to another tenant", async () => {
    const other = { id: 'other-admin', code: 'TENANT_ADMIN', tenantId: 'tenant-b' };
    const role = await pickProvisioningRole(TENANT, 'other-admin', finder([other, PLATFORM_VIEWER]));
    expect(role?.code).toBe('VIEWER');
  });

  it('returns null rather than any other role when no VIEWER role exists', async () => {
    const role = await pickProvisioningRole(TENANT, null, finder([TENANT_ADMIN, TENANT_DISPATCH]));
    expect(role).toBeNull();
  });
});
