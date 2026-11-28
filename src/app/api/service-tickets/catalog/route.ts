export const dynamic = 'force-dynamic';

/**
 * /api/service-tickets/catalog — Field Service Management Service Catalog & SLA master.
 *
 * GET  — the tenant's FSM Service Categories with their Service Types, each
 *        type's priority (P1–P4), trigger and SLA timers (response, on-site
 *        arrival, resolution), plus the priority tier definitions and
 *        whether the caller may edit. Any authenticated tenant user.
 *
 * POST — one change to the master. TENANT_ADMIN / SUPER_ADMIN only. Body:
 *   { action: 'createCategory', name, description? }
 *   { action: 'updateCategory', id, name, description? }
 *   { action: 'deleteCategory', id }                     (soft delete, with its types)
 *   { action: 'createType', categoryId, name, priority, trigger?, sla: { responseHours, onSiteHours, resolutionHours },
 *     approvalRequired?: boolean | 'Yes' | 'No' (default No), vehicleUsage?: string (default 'Service Delivery') }
 *   { action: 'updateType', id, categoryId?, name, priority, trigger?, sla, approvalRequired?, vehicleUsage? }
 *   { action: 'deleteType', id }                         (soft delete)
 *   { action: 'installStandard' }                        (standard catalogue; archives Facilities)
 * Existing requests keep their service type whatever happens here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import {
  CatalogError, PRIORITY_TIERS, STANDARD_CATALOG, listServiceCatalog,
  createCategory, updateCategory, deleteCategory, createType, updateType, deleteType,
  setCatalogTypeEnabled, installStandardCatalog,
} from '@/lib/service-tickets/service-catalog';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;

  try {
    const categories = await listServiceCatalog(auth.tenantId);
    return NextResponse.json({
      ok: true,
      categories,
      priorities: PRIORITY_TIERS,
      canEdit: requireAdmin(auth).ok,
      standard: {
        categories: STANDARD_CATALOG.length,
        types: STANDARD_CATALOG.reduce((n, c) => n + c.types.length, 0),
      },
    });
  } catch (err) {
    captureException(err, { context: 'service-tickets.catalog.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load the service catalog' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const admin = requireAdmin(auth);
  if (!admin.ok) return admin.res;

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields(await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const action = String(body.action ?? '');
  const id = String(body.id ?? '');
  const needsId = ['updateCategory', 'deleteCategory', 'updateType', 'deleteType', 'toggleType'].includes(action);
  if (needsId && !UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: 'A valid id is required.' }, { status: 400 });
  }
  if ((action === 'createType' || (action === 'updateType' && body.categoryId)) && !UUID_RE.test(String(body.categoryId ?? ''))) {
    return NextResponse.json({ ok: false, error: 'A valid service category is required.' }, { status: 400 });
  }

  const tenantId = auth.tenantId;
  const audit = (entityType: string, entityId: string, entityName: string, act: 'CREATE' | 'UPDATE' | 'DELETE', details: string) =>
    void logAudit({ tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType, entityId, entityName, action: act, details });

  try {
    switch (action) {
      case 'createCategory': {
        const newId = await createCategory(tenantId, body);
        audit('ServiceCategory', newId, String(body.name), 'CREATE', `Created FSM service category ${String(body.name)}`);
        return NextResponse.json({ ok: true, id: newId });
      }
      case 'updateCategory': {
        await updateCategory(tenantId, id, body);
        audit('ServiceCategory', id, String(body.name), 'UPDATE', `Updated FSM service category ${String(body.name)}`);
        return NextResponse.json({ ok: true });
      }
      case 'deleteCategory': {
        const r = await deleteCategory(tenantId, id);
        audit('ServiceCategory', id, r.name, 'DELETE', `Deleted FSM service category ${r.name} and ${r.typesRemoved} service type(s)`);
        return NextResponse.json({ ok: true, ...r });
      }
      case 'createType': {
        const newId = await createType(tenantId, body, auth.userId);
        audit('ServiceType', newId, String(body.name), 'CREATE', `Created FSM service type ${String(body.name)}`);
        return NextResponse.json({ ok: true, id: newId });
      }
      case 'updateType': {
        await updateType(tenantId, id, body, auth.userId);
        audit('ServiceType', id, String(body.name), 'UPDATE', `Updated FSM service type ${String(body.name)} (priority and SLA)`);
        return NextResponse.json({ ok: true });
      }
      case 'deleteType': {
        const name = await deleteType(tenantId, id);
        audit('ServiceType', id, name, 'DELETE', `Deleted FSM service type ${name}`);
        return NextResponse.json({ ok: true });
      }
      case 'toggleType': {
        if (typeof body.enabled !== 'boolean') {
          return NextResponse.json({ ok: false, error: 'enabled (boolean) is required.' }, { status: 400 });
        }
        const r = await setCatalogTypeEnabled(tenantId, id, body.enabled, auth.userId);
        audit(
          'ServiceType',
          id,
          r.name,
          'UPDATE',
          `${r.enabled ? 'Enabled' : 'Disabled'} FSM service type ${r.name} (${r.key})`,
        );
        return NextResponse.json({ ok: true, ...r });
      }
      case 'installStandard': {
        const r = await installStandardCatalog(tenantId);
        audit('ServiceCatalogueTemplate', 'FSM_STANDARD', 'FSM Service Catalog', 'CREATE',
          `Installed FSM standard catalogue: ${r.categoriesAdded} categories and ${r.typesAdded} types added; ${r.facilitiesArchived} Facilities types archived`);
        return NextResponse.json({ ok: true, ...r });
      }
      default:
        return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof CatalogError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    captureException(err, { context: `service-tickets.catalog.${action}` });
    return NextResponse.json({ ok: false, error: 'Failed to update the service catalog' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
