import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { ensureMfaColumns } from '@/lib/auth-mfa-schema';
import { getMfaPolicies } from '@/lib/mfa-policy';
import { getLoginSecuritySummary } from '@/lib/auth-security';

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'security');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const scopedTenantId = auth.ctx.isSuperAdmin && !searchParams.get('tenantId')
    ? ''
    : resolveTenantBoundary(auth.ctx, searchParams.get('tenantId'));
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;

  await ensureMfaColumns();
  const policies = await getMfaPolicies(scopedTenantId || auth.ctx.tenantId);

  const tenantFilter = scopedTenantId ? 'WHERE ut.tenant_id = $1' : '';
  const params = scopedTenantId ? [scopedTenantId] : [];
  const [mfa] = await prisma.$queryRawUnsafe<Array<{
    total_users: bigint;
    mfa_enabled: bigint;
    tenant_admins: bigint;
    tenant_admins_without_mfa: bigint;
  }>>(
    `SELECT
       COUNT(DISTINCT u.id) AS total_users,
       COUNT(DISTINCT u.id) FILTER (WHERE u.mfa_enabled = TRUE) AS mfa_enabled,
       COUNT(DISTINCT u.id) FILTER (WHERE r.code IN ('SUPER_ADMIN','TENANT_ADMIN')) AS tenant_admins,
       COUNT(DISTINCT u.id) FILTER (
         WHERE r.code IN ('SUPER_ADMIN','TENANT_ADMIN') AND COALESCE(u.mfa_enabled, FALSE) = FALSE
       ) AS tenant_admins_without_mfa
     FROM user_tenants ut
     JOIN "User" u ON u.id = ut.user_id
     JOIN roles r ON r.id = ut.role_id
     ${tenantFilter}`,
    ...params,
  ).catch(() => [{ total_users: BigInt(0), mfa_enabled: BigInt(0), tenant_admins: BigInt(0), tenant_admins_without_mfa: BigInt(0) }]);
  const loginSecurity = await getLoginSecuritySummary(scopedTenantId || undefined);

  return NextResponse.json({
    mfa: {
      totalUsers: Number(mfa?.total_users ?? 0),
      enabledUsers: Number(mfa?.mfa_enabled ?? 0),
      adminUsers: Number(mfa?.tenant_admins ?? 0),
      adminUsersWithoutMfa: Number(mfa?.tenant_admins_without_mfa ?? 0),
    },
    policy: {
      enforcedAtLogin: !!(policies.platform.isEnabled || policies.tenant?.isEnabled),
      platform: policies.platform,
      tenant: policies.tenant,
      note: policies.platform.isEnabled || policies.tenant?.isEnabled
        ? 'MFA policy is enforced at login for matching users.'
        : 'MFA enrollment exists. No mandatory MFA policy is enabled yet.',
    },
    loginSecurity,
  }, {
    headers: { 'Cache-Control': 'private, max-age=20, stale-while-revalidate=60' },
  });
}
