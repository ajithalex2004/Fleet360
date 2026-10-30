export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/nav-permissions          — returns enabled nav keys for current tenant
 * GET  /api/admin/nav-permissions?tenantId — super admin fetches for a specific tenant
 * PUT  /api/admin/nav-permissions          — super admin updates nav permissions for a tenant
 *
 * Nav keys that can be toggled per-tenant for TENANT_ADMIN:
 *   branches | billing | workflows | esign | whatsapp | dispatch | audit-logs
 *
 * Always visible to TENANT_ADMIN (no toggle): overview | users | roles
 * Never visible to TENANT_ADMIN:              tenants | platform-info | notifications | integrations | settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import crypto from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
// Keys that the platform admin can enable/disable per tenant
// Not exported: Next.js route.ts files may only export HTTP method handlers
// and reserved config constants (dynamic, revalidate, runtime, ...) --
// exporting anything else fails next build's route-shape validation.
// Nothing outside this file imports these.
const TOGGLEABLE_NAV_KEYS = [
  // Organization & Masters
  'hierarchy',
  'branches',
  'nui-reasons',
  'company-profile',

  // Operations & Workflows
  'service-config',
  'workflows',
  'dispatch',
  'shipper-portal-config',
  'partner-onboarding',

  // Communications & Alerts
  'notifications',
  'email-templates',
  'whatsapp',
  'esign',
  'alerts',

  // Commercial & Governance
  'billing',
  'audit-logs',
  'integrations',
] as const;

// Organization & Masters + Audit Log default to true unless disabled;
// Operations & Workflows, Communications & Alerts, and Subscription & Integrations
// default to false (hidden from Tenant Admin unless Super Admin grants access).
const DEFAULT_ENABLED_NAV_KEYS = new Set<string>([
  'hierarchy',
  'branches',
  'nui-reasons',
  'company-profile',
  'audit-logs',
]);

// ── GET — fetch enabled nav keys ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authz = requireAuthorizedTenant(
    { headers: request.headers, nextUrl: request.nextUrl },
    // A platform admin reads another tenant's records via ?tenantId=
    // (Admin > Tenants > Manage); anyone else still gets 403.
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const role     = request.headers.get('x-user-role') ?? '';
  const myTenant = request.headers.get('x-tenant-id') ?? '';

  // Super admin can query any tenant via ?tenantId=xxx
  const url      = new URL(request.url);
  const targetId = (role === 'SUPER_ADMIN' && url.searchParams.get('tenantId'))
    ? url.searchParams.get('tenantId')!
    : myTenant;

  if (!targetId) {
    return NextResponse.json({ error: 'tenant not resolved' }, { status: 400 });
  }

  type Row = { nav_key: string; enabled: boolean };
  // tenant_admin_nav_permissions has tenant_id with RLS. Wrap with
  // withTenantRls(targetId) so the SELECT is constrained to that tenant.
  const rows = await withTenantRls(prisma, targetId, (tx) =>
    tx.$queryRawUnsafe<Row[]>(
      `SELECT nav_key, enabled FROM tenant_admin_nav_permissions WHERE tenant_id = $1`,
      targetId,
    )
  );

  // Build a full map — Organization & Masters / Audit Log default to true;
  // Operations & Workflows, Communications & Alerts, Subscription & Integrations default to false
  const map: Record<string, boolean> = {};
  for (const key of TOGGLEABLE_NAV_KEYS) map[key] = DEFAULT_ENABLED_NAV_KEYS.has(key);
  for (const row of rows) map[row.nav_key] = row.enabled;

  return NextResponse.json({ tenantId: targetId, permissions: map });
}

// ── PUT — super admin updates permissions for a tenant ─────────────────────────

async function handlePUT(request: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const role = request.headers.get('x-user-role') ?? '';
  if (role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden — Super Admin only' }, { status: 403 });
  }

  // Super admin may target any tenant — the body's tenantId, not the
  // caller's own authz-derived one, is the write target here.
  const body = await request.json() as { tenantId: string; permissions: Record<string, boolean> };
  const { tenantId: targetTenantId, permissions } = body;

  if (!targetTenantId || typeof permissions !== 'object') {
    return NextResponse.json({ error: 'tenantId and permissions required' }, { status: 400 });
  }

  // Upsert each toggleable key + any dynamic Menu (mod:*), Category (cat:*), Sub-Menu (sub:*), or Other-User (other:*) key
  const allKeysToSave = new Set<string>([
    ...TOGGLEABLE_NAV_KEYS,
    ...Object.keys(permissions).filter(
      (k) =>
        k.startsWith('cat:') ||
        k.startsWith('mod:') ||
        k.startsWith('sub:') ||
        k.startsWith('other:') ||
        k === 'overview' ||
        k === 'users' ||
        k === 'roles',
    ),
  ]);

  await withTenantRls(prisma, targetTenantId, async (tx) => {
    for (const key of allKeysToSave) {
      if (!(key in permissions) && !TOGGLEABLE_NAV_KEYS.includes(key as any)) continue;
      const enabled = permissions[key] === true;
      await tx.$executeRawUnsafe(
        `INSERT INTO tenant_admin_nav_permissions (id, tenant_id, nav_key, enabled, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (tenant_id, nav_key) DO UPDATE SET enabled = $4, updated_at = NOW()`,
        crypto.randomUUID(),
        targetTenantId,
        key,
        enabled,
      );
    }
  });

  return NextResponse.json({ ok: true, tenantId: targetTenantId });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
