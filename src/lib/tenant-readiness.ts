import { prisma } from '@/lib/prisma';
import { getCanonicalBillingAccount } from '@/lib/canonical-billing';
import { getSsoConfigPublic, validateSsoConfigReadiness } from '@/lib/sso';

export type TenantReadinessSeverity = 'blocker' | 'warning' | 'info' | 'pass';
export type TenantReadinessStatus = 'READY' | 'ATTENTION' | 'BLOCKED';

export interface TenantReadinessCheck {
  key: string;
  category: 'identity' | 'access' | 'modules' | 'billing' | 'security' | 'configuration' | 'operations';
  label: string;
  severity: TenantReadinessSeverity;
  message: string;
  actionHref?: string;
}

export interface TenantReadiness {
  tenantId: string;
  score: number;
  status: TenantReadinessStatus;
  blockers: TenantReadinessCheck[];
  warnings: TenantReadinessCheck[];
  checks: TenantReadinessCheck[];
  categories: Array<{
    key: TenantReadinessCheck['category'];
    label: string;
    score: number;
    status: TenantReadinessStatus;
    blockers: number;
    warnings: number;
    passes: number;
  }>;
  metrics: {
    enabledModules: number;
    totalModules: number;
    activeUsers: number;
    adminUsers: number;
    adminUsersWithoutMfa: number;
    roles: number;
    branches: number;
    pendingApprovals: number;
    openInvitations: number;
    activeSessions: number;
    failedLogins24h: number;
    serviceTypes: number;
    activeServiceRules: number;
    activeModuleSubscriptions: number;
  };
  billing: null | {
    model: string;
    status: string;
    effectivePlan: string;
    moduleMrr: number;
    activeModuleSubscriptions: number;
    currency: string;
  };
  generatedAt: string;
}

type CountRow = { count: bigint | number | string };

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return 0;
}

async function countSql(sql: string, ...params: unknown[]) {
  const rows = await prisma.$queryRawUnsafe<CountRow[]>(sql, ...params).catch(() => [{ count: 0 }]);
  return toNumber(rows[0]?.count);
}

function check(
  key: TenantReadinessCheck['key'],
  category: TenantReadinessCheck['category'],
  label: string,
  severity: TenantReadinessSeverity,
  message: string,
  actionHref?: string,
): TenantReadinessCheck {
  return { key, category, label, severity, message, actionHref };
}

function statusFromIssues(blockers: number, warnings: number): TenantReadinessStatus {
  if (blockers > 0) return 'BLOCKED';
  if (warnings > 0) return 'ATTENTION';
  return 'READY';
}

export async function getTenantReadiness(tenantId: string): Promise<TenantReadiness | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      plan: true,
      isActive: true,
      contactEmail: true,
      domain: true,
    },
  });
  if (!tenant) return null;

  const [
    moduleRows,
    roleCount,
    activeUsers,
    adminUserRows,
    branches,
    pendingApprovals,
    openInvitations,
    activeSessions,
    failedLogins24h,
    serviceConfigRows,
    billing,
    ssoConfig,
  ] = await Promise.all([
    prisma.tenantModule.findMany({
      where: { tenantId },
      orderBy: { module: 'asc' },
      select: { module: true, isEnabled: true },
    }),
    prisma.role.count({ where: { tenantId } }),
    prisma.userTenant.count({ where: { tenantId, isActive: true } }),
    prisma.$queryRawUnsafe<Array<{ admin_users: bigint; admin_without_mfa: bigint }>>(
      `SELECT
         COUNT(DISTINCT u.id) FILTER (WHERE r.code IN ('SUPER_ADMIN','TENANT_ADMIN')) AS admin_users,
         COUNT(DISTINCT u.id) FILTER (
           WHERE r.code IN ('SUPER_ADMIN','TENANT_ADMIN') AND COALESCE(u.mfa_enabled, FALSE) = FALSE
         ) AS admin_without_mfa
       FROM user_tenants ut
       JOIN "User" u ON u.id = ut.user_id
       JOIN roles r ON r.id = ut.role_id
       WHERE ut.tenant_id = $1 AND COALESCE(ut.is_active, TRUE) = TRUE`,
      tenantId,
    ).catch(() => [{ admin_users: BigInt(0), admin_without_mfa: BigInt(0) }]),
    countSql(`SELECT COUNT(*)::bigint AS count FROM tenant_branches WHERE tenant_id = $1 AND COALESCE(is_active, true) = true`, tenantId),
    countSql(`SELECT COUNT(*)::bigint AS count FROM admin_approval_requests WHERE tenant_id = $1 AND status = 'PENDING'`, tenantId),
    countSql(`SELECT COUNT(*)::bigint AS count FROM tenant_invitations WHERE tenant_id = $1 AND status IN ('PENDING', 'SENT')`, tenantId),
    countSql(`SELECT COUNT(*)::bigint AS count FROM auth_sessions WHERE tenant_id = $1 AND revoked_at IS NULL`, tenantId),
    countSql(
      `SELECT COUNT(*)::bigint AS count
         FROM auth_login_attempts
        WHERE tenant_id = $1
          AND success = false
          AND occurred_at >= NOW() - INTERVAL '24 hours'`,
      tenantId,
    ),
    prisma.$queryRawUnsafe<Array<{ service_types: bigint; active_rules: bigint }>>(
      `SELECT
         (SELECT COUNT(*)::bigint FROM service_types WHERE (tenant_id = $1 OR tenant_id IS NULL) AND deleted_at IS NULL) AS service_types,
         (SELECT COUNT(*)::bigint
            FROM service_rules r
            JOIN service_types t ON t.id = r.service_type_id
           WHERE t.tenant_id = $1
             AND r.effective_to IS NULL) AS active_rules`,
      tenantId,
    ).catch(() => [{ service_types: BigInt(0), active_rules: BigInt(0) }]),
    getCanonicalBillingAccount(tenantId).catch(() => null),
    getSsoConfigPublic(tenantId).catch(() => null),
  ]);

  const enabledModules = moduleRows.filter(row => row.isEnabled).map(row => row.module);
  const serviceConfig = serviceConfigRows[0] ?? { service_types: BigInt(0), active_rules: BigInt(0) };
  const adminUsers = toNumber(adminUserRows[0]?.admin_users);
  const adminUsersWithoutMfa = toNumber(adminUserRows[0]?.admin_without_mfa);
  const billingSummary = billing
    ? {
        model: billing.billingModel,
        status: billing.billingStatus,
        effectivePlan: billing.effectivePlan,
        moduleMrr: billing.moduleMrr,
        activeModuleSubscriptions: billing.activeModuleSubscriptions,
        currency: billing.currency,
      }
    : null;

  const checks: TenantReadinessCheck[] = [
    check(
      'tenant-active',
      'identity',
      'Tenant status',
      tenant.isActive ? 'pass' : 'blocker',
      tenant.isActive ? 'Tenant is active.' : 'Tenant is inactive and users cannot operate normally.',
      `/admin/tenants/${tenantId}`,
    ),
    check(
      'tenant-contact',
      'identity',
      'Admin contact',
      tenant.contactEmail ? 'pass' : 'warning',
      tenant.contactEmail ? 'Tenant has an admin/billing contact.' : 'Tenant is missing an admin or billing contact email.',
      `/admin/tenants/${tenantId}`,
    ),
    check(
      'enabled-modules',
      'modules',
      'Module access',
      enabledModules.length > 0 ? 'pass' : 'blocker',
      enabledModules.length > 0 ? `${enabledModules.length} module(s) enabled.` : 'No modules are enabled for this tenant.',
      `/admin/tenants/${tenantId}`,
    ),
    check(
      'module-billing-sync',
      'billing',
      'Billing reconciliation',
      billingSummary && billingSummary.activeModuleSubscriptions !== enabledModules.length ? 'warning' : 'pass',
      billingSummary
        ? `${billingSummary.activeModuleSubscriptions} active billing subscription(s) for ${enabledModules.length} enabled module(s).`
        : 'Canonical billing account could not be loaded.',
      '/admin/billing',
    ),
    check(
      'billing-status',
      'billing',
      'Billing status',
      !billingSummary || ['ACTIVE', 'TRIAL'].includes(String(billingSummary.status).toUpperCase()) ? 'pass' : 'warning',
      billingSummary ? `Billing status is ${billingSummary.status}.` : 'Tenant is using plan billing only.',
      '/admin/billing',
    ),
    check(
      'active-users',
      'access',
      'User assignment',
      activeUsers > 0 ? 'pass' : 'blocker',
      activeUsers > 0 ? `${activeUsers} active user(s) assigned.` : 'No active users are assigned to this tenant.',
      `/admin/tenants/${tenantId}`,
    ),
    check(
      'tenant-roles',
      'access',
      'Role model',
      roleCount > 0 ? 'pass' : 'warning',
      roleCount > 0 ? `${roleCount} role(s) configured.` : 'No tenant roles are configured.',
      `/admin/tenants/${tenantId}`,
    ),
    check(
      'admin-mfa',
      'security',
      'Admin MFA coverage',
      adminUsersWithoutMfa > 0 ? 'warning' : 'pass',
      adminUsersWithoutMfa > 0
        ? `${adminUsersWithoutMfa} admin user(s) do not have MFA enabled.`
        : 'Admin MFA coverage is clean.',
      '/admin/security',
    ),
    check(
      'failed-logins',
      'security',
      'Failed login review',
      failedLogins24h > 0 ? 'warning' : 'pass',
      failedLogins24h > 0 ? `${failedLogins24h} failed login(s) in the last 24 hours.` : 'No failed-login spike in the last 24 hours.',
      '/admin/security',
    ),
    (() => {
      const readiness = ssoConfig
        ? validateSsoConfigReadiness({
            issuer: ssoConfig.issuer,
            clientId: ssoConfig.clientId,
            clientSecret: ssoConfig.clientSecretSet ? 'configured' : '',
            allowedEmailDomains: ssoConfig.allowedEmailDomains,
            isActive: ssoConfig.isActive,
          })
        : null;
      return check(
      'sso-readiness',
      'security',
      'SSO readiness',
      readiness && readiness.status !== 'ready' ? 'warning' : 'pass',
      readiness
        ? readiness.status === 'ready'
          ? 'SSO configuration is ready.'
          : `SSO needs attention: ${readiness.issues.join(', ')}.`
        : 'SSO is not configured for this tenant.',
      `/admin/tenants/${tenantId}/sso`,
      );
    })(),
    check(
      'service-types',
      'configuration',
      'Service configuration',
      toNumber(serviceConfig.service_types) > 0 ? 'pass' : 'warning',
      toNumber(serviceConfig.service_types) > 0
        ? `${toNumber(serviceConfig.service_types)} service type(s) available.`
        : 'No service types are configured for this tenant.',
      '/admin/service-config',
    ),
    check(
      'branches',
      'configuration',
      'Branches and regions',
      branches > 0 ? 'pass' : 'info',
      branches > 0 ? `${branches} active branch(es).` : 'No active branches configured yet.',
      '/admin/branches',
    ),
    check(
      'pending-approvals',
      'operations',
      'Approval queue',
      pendingApprovals > 0 ? 'warning' : 'pass',
      pendingApprovals > 0 ? `${pendingApprovals} pending approval(s) need action.` : 'No pending approvals.',
      '/admin/approvals',
    ),
    check(
      'open-invitations',
      'operations',
      'Invitation lifecycle',
      openInvitations > 0 ? 'info' : 'pass',
      openInvitations > 0 ? `${openInvitations} invitation(s) are still open.` : 'No open invitations.',
      `/admin/tenants/${tenantId}/invitations`,
    ),
  ];

  const blockers = checks.filter(item => item.severity === 'blocker');
  const warnings = checks.filter(item => item.severity === 'warning');
  const score = Math.max(0, 100 - blockers.length * 25 - warnings.length * 10 - checks.filter(item => item.severity === 'info').length * 3);
  const categories = (['identity', 'access', 'modules', 'billing', 'security', 'configuration', 'operations'] as const).map(category => {
    const categoryChecks = checks.filter(item => item.category === category);
    const categoryBlockers = categoryChecks.filter(item => item.severity === 'blocker').length;
    const categoryWarnings = categoryChecks.filter(item => item.severity === 'warning').length;
    const categoryInfo = categoryChecks.filter(item => item.severity === 'info').length;
    return {
      key: category,
      label: category.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join(' '),
      score: Math.max(0, 100 - categoryBlockers * 35 - categoryWarnings * 15 - categoryInfo * 5),
      status: statusFromIssues(categoryBlockers, categoryWarnings),
      blockers: categoryBlockers,
      warnings: categoryWarnings,
      passes: categoryChecks.filter(item => item.severity === 'pass').length,
    };
  });

  return {
    tenantId,
    score,
    status: statusFromIssues(blockers.length, warnings.length),
    blockers,
    warnings,
    checks,
    categories,
    metrics: {
      enabledModules: enabledModules.length,
      totalModules: moduleRows.length,
      activeUsers,
      adminUsers,
      adminUsersWithoutMfa,
      roles: roleCount,
      branches,
      pendingApprovals,
      openInvitations,
      activeSessions,
      failedLogins24h,
      serviceTypes: toNumber(serviceConfig.service_types),
      activeServiceRules: toNumber(serviceConfig.active_rules),
      activeModuleSubscriptions: billingSummary?.activeModuleSubscriptions ?? 0,
    },
    billing: billingSummary,
    generatedAt: new Date().toISOString(),
  };
}

export async function listTenantReadiness(tenantIds: string[]) {
  const rows = await Promise.all(tenantIds.map(id => getTenantReadiness(id)));
  return rows.filter((row): row is TenantReadiness => !!row);
}
