export const dynamic = 'force-dynamic';

/**
 * /api/admin/tenants/[id]/fsm-catalog — Field Service Management catalogue for a tenant.
 *
 * GET  — how much of the catalogue the tenant has:
 *        { categories, types, standardCategories, standardTypes }.
 * POST — load the standard FSM catalogue (11 categories, 33 service types with
 *        priority, SLA timers, approval and vehicle usage) into the tenant and
 *        archive its Facilities catalogue. Idempotent; never overwrites the
 *        tenant's edits. Same action as "Load standard catalogue" on the
 *        tenant's own Service Catalog & SLA page, without impersonating.
 *
 * Authorization: SUPER_ADMIN for any tenant, or that tenant's TENANT_ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsTenant } from '@/lib/rls-scope';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { catalogStatus, installStandardCatalog } from '@/lib/service-tickets/service-catalog';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

type Auth = { ok: true; userId: string; role: string } | { ok: false; res: NextResponse };

function authorize(req: NextRequest, tenantId: string, write: boolean): Auth {
  const role = req.headers.get('x-user-role') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const ctxTenant = req.headers.get('x-tenant-id') ?? '';
  if (!userId) return { ok: false, res: NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }) };
  const ownTenantAdmin = ctxTenant === tenantId && (role === 'TENANT_ADMIN' || !write);
  if (role !== 'SUPER_ADMIN' && !ownTenantAdmin) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId, role };
}

async function tenantName(tenantId: string): Promise<string | null> {
  const row = await withTenantRls(prisma, tenantId, (tx) =>
    tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ).catch(() => null);
  return row?.name ?? null;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId, false);
  if (!auth.ok) return auth.res;

  try {
    // service_* tables are under RLS; read as the target tenant.
    const status = await runAsTenant(tenantId, () => catalogStatus(tenantId));
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    captureException(err, { context: 'admin.tenants.fsm-catalog.status' });
    return NextResponse.json({ ok: false, error: 'Failed to read the FSM catalogue' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId, true);
  if (!auth.ok) return auth.res;

  const name = await tenantName(tenantId);
  if (!name) return NextResponse.json({ ok: false, error: 'Tenant not found' }, { status: 404 });

  try {
    const result = await runAsTenant(tenantId, () => installStandardCatalog(tenantId));
    const status = await runAsTenant(tenantId, () => catalogStatus(tenantId));
    void logAudit({
      tenantId, userId: auth.userId, userRole: auth.role || undefined,
      entityType: 'ServiceCatalogueTemplate', entityId: 'FSM_STANDARD', entityName: `FSM Service Catalog (${name})`,
      action: 'CREATE',
      details: `Loaded FSM standard catalogue for ${name}: ${result.categoriesAdded} categories and ${result.typesAdded} types added; ${result.facilitiesArchived} Facilities types archived`,
    });
    return NextResponse.json({ ok: true, ...result, ...status });
  } catch (err) {
    captureException(err, { context: 'admin.tenants.fsm-catalog.install' });
    return NextResponse.json({ ok: false, error: 'Failed to load the FSM catalogue' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
