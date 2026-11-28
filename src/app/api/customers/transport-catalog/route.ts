export const dynamic = 'force-dynamic';

/**
 * Transport Services catalogue for the tenant.
 *
 * GET    /api/customers/transport-catalog
 *   Built-in + tenant custom Transport categories with Customer Portal &
 *   Booking Portal availability, approval, dynamic module mapping, custom
 *   sections/fields, field overrides + default values, and effective forms.
 * PUT    /api/customers/transport-catalog
 *   Body: { category, enabled?, bookingPortalEnabled?, approvalRequired?,
 *           moduleKey?, title?, description?, icon?, badge?, accent?,
 *           fieldOverrides?, customFormConfig? }
 * POST   /api/customers/transport-catalog
 *   - If `action === 'create'`: creates a new custom Transport category
 *     (TENANT_ADMIN / SUPER_ADMIN only).
 *   - Otherwise: `{ category, values }` — validates a sample entry against
 *     the tenant's effective form (used by the preview tab).
 * DELETE /api/customers/transport-catalog?category=CODE
 *   Deletes a tenant-defined custom category (built-in categories cannot be
 *   deleted; toggle them off instead). TENANT_ADMIN / SUPER_ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { isValidCategoryCode } from '@/lib/customer-portal/catalog';
import {
  CatalogError,
  createCustomTenantCategory,
  deleteCustomTenantCategory,
  getTenantCatalog,
  getTenantCategory,
  updateTenantCategory,
} from '@/lib/transport-catalog/store';
import { validateRequestValues } from '@/lib/transport-catalog/form-schema';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  try {
    const categories = await getTenantCatalog(auth.tenantId);
    return NextResponse.json({ ok: true, categories, canEdit: requireAdmin(auth).ok });
  } catch (err) {
    captureException(err, { context: 'customers.transport-catalog.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load the Transport catalogue' }, { status: 500 });
  }
}

async function handlePUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const admin = requireAdmin(auth);
  if (!admin.ok) return admin.res;

  const body = stripTenantOwnershipFields((await req.json().catch(() => ({}))) as Record<string, unknown>);
  try {
    const cat = await updateTenantCategory(auth.tenantId, body.category, {
      enabled: body.enabled,
      bookingPortalEnabled: body.bookingPortalEnabled,
      approvalRequired: body.approvalRequired,
      moduleKey: body.moduleKey,
      title: body.title,
      description: body.description,
      vehicleUsage: body.vehicleUsage,
      icon: body.icon,
      badge: body.badge,
      accent: body.accent,
      sortOrder: body.sortOrder,
      fieldOverrides: body.fieldOverrides,
      customFormConfig: body.customFormConfig,
    }, auth.userId);
    const changes = [
      typeof body.enabled === 'boolean' ? (body.enabled ? 'customer portal on' : 'customer portal off') : null,
      typeof body.bookingPortalEnabled === 'boolean' ? (body.bookingPortalEnabled ? 'booking portal on' : 'booking portal off') : null,
      typeof body.approvalRequired === 'boolean' ? `approval ${body.approvalRequired ? 'required' : 'not required'}` : null,
      body.moduleKey !== undefined ? `module ${cat.moduleKey ?? 'all-staff'}` : null,
      body.fieldOverrides !== undefined ? `${Object.keys(cat.fieldOverrides).length} field override(s)` : null,
      body.customFormConfig !== undefined
        ? `${cat.customFormConfig.sections?.length ?? 0} custom section(s), ${cat.customFormConfig.fields?.length ?? 0} custom field(s)`
        : null,
    ].filter(Boolean).join(', ');
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'TransportCategory',
      entityId: cat.category, entityName: cat.title, action: 'UPDATE',
      details: `Transport catalogue — ${cat.title}: ${changes || 'updated'}`,
    });
    return NextResponse.json({ ok: true, category: cat });
  } catch (err) {
    if (err instanceof CatalogError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customers.transport-catalog.update' });
    return NextResponse.json({ ok: false, error: 'Failed to update the category' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const body = stripTenantOwnershipFields((await req.json().catch(() => ({}))) as Record<string, unknown>);

  // Create custom category
  if (body.action === 'create') {
    const admin = requireAdmin(auth);
    if (!admin.ok) return admin.res;
    try {
      const cat = await createCustomTenantCategory(auth.tenantId, {
        category: body.category,
        title: body.title,
        description: body.description,
        vehicleUsage: body.vehicleUsage,
        icon: body.icon,
        badge: body.badge,
        accent: body.accent,
        moduleKey: body.moduleKey,
        template: body.template,
        enabled: body.enabled,
        bookingPortalEnabled: body.bookingPortalEnabled,
        approvalRequired: body.approvalRequired,
      }, auth.userId);
      void logAudit({
        tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'TransportCategory',
        entityId: cat.category, entityName: cat.title, action: 'CREATE',
        details: `Created custom Transport category ${cat.title} (${cat.category})`,
      });
      return NextResponse.json({ ok: true, category: cat }, { status: 201 });
    } catch (err) {
      if (err instanceof CatalogError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      captureException(err, { context: 'customers.transport-catalog.create' });
      return NextResponse.json({ ok: false, error: 'Failed to create the category' }, { status: 500 });
    }
  }

  // Preview validation check
  if (!isValidCategoryCode(body.category)) {
    return NextResponse.json({ ok: false, error: 'Unknown Transport category.' }, { status: 400 });
  }
  try {
    const cat = await getTenantCategory(auth.tenantId, body.category);
    const result = validateRequestValues(cat.effectiveForm, body.values);
    return NextResponse.json({ ok: true, valid: result.ok, errors: result.errors, values: result.values });
  } catch (err) {
    if (err instanceof CatalogError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customers.transport-catalog.check' });
    return NextResponse.json({ ok: false, error: 'Failed to check the request' }, { status: 500 });
  }
}

async function handleDELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const admin = requireAdmin(auth);
  if (!admin.ok) return admin.res;

  const category = req.nextUrl.searchParams.get('category') ?? '';
  try {
    const deleted = await deleteCustomTenantCategory(auth.tenantId, category);
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'TransportCategory',
      entityId: deleted.category, entityName: deleted.title, action: 'DELETE',
      details: `Deleted custom Transport category ${deleted.title} (${deleted.category})`,
    });
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    if (err instanceof CatalogError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customers.transport-catalog.delete' });
    return NextResponse.json({ ok: false, error: 'Failed to delete the category' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
export const POST = withAuditedAction(handlePOST);
export const DELETE = withAuditedAction(handleDELETE);
