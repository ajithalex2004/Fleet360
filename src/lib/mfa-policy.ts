import { prisma } from '@/lib/prisma';

export type MfaPolicyScope = 'PLATFORM' | 'TENANT';

export interface MfaPolicy {
  id?: string;
  scope: MfaPolicyScope;
  tenantId: string | null;
  requireAllUsers: boolean;
  requireAdminRoles: boolean;
  requiredRoleCodes: string[];
  gracePeriodHours: number;
  isEnabled: boolean;
  updatedAt?: string | null;
}

let ensured = false;

export async function ensureMfaPolicyTable() {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS admin_mfa_policies (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope               TEXT NOT NULL,
      tenant_id           TEXT,
      require_all_users   BOOLEAN NOT NULL DEFAULT FALSE,
      require_admin_roles BOOLEAN NOT NULL DEFAULT TRUE,
      required_role_codes JSONB NOT NULL DEFAULT '[]',
      grace_period_hours  INTEGER NOT NULL DEFAULT 0,
      is_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
      updated_by          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(scope, tenant_id)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_mfa_policies_platform
    ON admin_mfa_policies(scope)
    WHERE tenant_id IS NULL
  `).catch(() => {});
  ensured = true;
}

function normalizePolicy(row: any, fallbackScope: MfaPolicyScope, fallbackTenantId: string | null): MfaPolicy {
  return {
    id: row?.id ?? undefined,
    scope: row?.scope ?? fallbackScope,
    tenantId: row?.tenant_id ?? fallbackTenantId,
    requireAllUsers: !!row?.require_all_users,
    requireAdminRoles: row?.require_admin_roles !== false,
    requiredRoleCodes: Array.isArray(row?.required_role_codes) ? row.required_role_codes : [],
    gracePeriodHours: Number(row?.grace_period_hours ?? 0),
    isEnabled: !!row?.is_enabled,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getMfaPolicies(tenantId?: string | null, opts?: { ensure?: boolean }) {
  if (opts?.ensure !== false) {
    await ensureMfaPolicyTable();
  }
  const platformRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id::text, scope, tenant_id, require_all_users, require_admin_roles,
            required_role_codes, grace_period_hours, is_enabled, updated_at::text
       FROM admin_mfa_policies
      WHERE scope = 'PLATFORM' AND tenant_id IS NULL
      LIMIT 1`,
  ).catch(() => []);
  const tenantRows = tenantId
    ? await prisma.$queryRawUnsafe<any[]>(
        `SELECT id::text, scope, tenant_id, require_all_users, require_admin_roles,
                required_role_codes, grace_period_hours, is_enabled, updated_at::text
           FROM admin_mfa_policies
          WHERE scope = 'TENANT' AND tenant_id = $1
          LIMIT 1`,
        tenantId,
      ).catch(() => [])
    : [];
  return {
    platform: normalizePolicy(platformRows[0], 'PLATFORM', null),
    tenant: tenantId ? normalizePolicy(tenantRows[0], 'TENANT', tenantId) : null,
  };
}

export async function upsertMfaPolicy(args: {
  scope: MfaPolicyScope;
  tenantId?: string | null;
  requireAllUsers: boolean;
  requireAdminRoles: boolean;
  requiredRoleCodes: string[];
  gracePeriodHours: number;
  isEnabled: boolean;
  updatedBy: string;
}) {
  await ensureMfaPolicyTable();
  const tenantId = args.scope === 'PLATFORM' ? null : args.tenantId ?? null;
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    args.scope === 'PLATFORM'
      ? `SELECT id::text FROM admin_mfa_policies WHERE scope = 'PLATFORM' AND tenant_id IS NULL LIMIT 1`
      : `SELECT id::text FROM admin_mfa_policies WHERE scope = 'TENANT' AND tenant_id = $1 LIMIT 1`,
    ...(args.scope === 'TENANT' ? [tenantId] : []),
  ).catch(() => []);
  if (existing[0]) {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE admin_mfa_policies
          SET require_all_users = $2,
              require_admin_roles = $3,
              required_role_codes = $4::jsonb,
              grace_period_hours = $5,
              is_enabled = $6,
              updated_by = $7,
              updated_at = NOW()
        WHERE id = $1::uuid
        RETURNING id::text, scope, tenant_id, require_all_users, require_admin_roles,
                  required_role_codes, grace_period_hours, is_enabled, updated_at::text`,
      existing[0].id,
      args.requireAllUsers,
      args.requireAdminRoles,
      JSON.stringify(args.requiredRoleCodes),
      Number(args.gracePeriodHours ?? 0),
      args.isEnabled,
      args.updatedBy,
    );
    return normalizePolicy(rows[0], args.scope, tenantId);
  }
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO admin_mfa_policies
       (scope, tenant_id, require_all_users, require_admin_roles, required_role_codes,
        grace_period_hours, is_enabled, updated_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     RETURNING id::text, scope, tenant_id, require_all_users, require_admin_roles,
               required_role_codes, grace_period_hours, is_enabled, updated_at::text`,
    args.scope,
    tenantId,
    args.requireAllUsers,
    args.requireAdminRoles,
    JSON.stringify(args.requiredRoleCodes),
    Number(args.gracePeriodHours ?? 0),
    args.isEnabled,
    args.updatedBy,
  );
  return normalizePolicy(rows[0], args.scope, tenantId);
}

export async function resolveMfaRequirement(args: {
  tenantId: string;
  roleCode: string;
  userCreatedAt?: Date | string | null;
}) {
  const { platform, tenant } = await getMfaPolicies(args.tenantId, { ensure: false });
  const policies = [platform, tenant].filter((p): p is MfaPolicy => !!p && p.isEnabled);
  const matched = policies.find(policy => {
    if (policy.requireAllUsers) return true;
    if (policy.requireAdminRoles && ['SUPER_ADMIN', 'TENANT_ADMIN'].includes(args.roleCode)) return true;
    return policy.requiredRoleCodes.includes(args.roleCode);
  });
  if (!matched) return { required: false, policy: null, graceActive: false };

  let graceActive = false;
  if (matched.gracePeriodHours > 0 && args.userCreatedAt) {
    const createdAt = new Date(args.userCreatedAt).getTime();
    graceActive = Number.isFinite(createdAt) && Date.now() - createdAt < matched.gracePeriodHours * 60 * 60 * 1000;
  }
  return { required: !graceActive, policy: matched, graceActive };
}
