export const dynamic = 'force-dynamic';

/**
 * Transport Services catalogue for the tenant.
 *
 * GET  /api/customers/transport-catalog
 *   The eight Transport categories with this tenant's settings: offered or
 *   not, approval, field changes, and the default and effective request form.
 * PUT  /api/customers/transport-catalog
 *   Body: { category, enabled?, approvalRequired?, fieldOverrides? }
 *   fieldOverrides: { fieldKey: { hidden?: boolean, required?: boolean } } (replaces the set).
 * POST /api/customers/transport-catalog
 *   Body: { category, values } — checks a sample request against the tenant's
 *   form, as a submission will be checked (used by the form preview).
 * Writes: TENANT_ADMIN / SUPER_ADMIN only; PUT and POST go through withAuditedAction.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { isTransportCategory } from '@/lib/customer-portal/catalog';
import { CatalogError, getTenantCatalog, getTenantCategory, updateTenantCategory } from '@/lib/transport-catalog/store';
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
      enabled: body.enabled, approvalRequired: body.approvalRequired, fieldOverrides: body.fieldOverrides,
    }, auth.userId);
    const changes = [
      typeof body.enabled === 'boolean' ? (body.enabled ? 'offered' : 'not offered') : null,
      typeof body.approvalRequired === 'boolean' ? `approval ${body.approvalRequired ? 'required' : 'not required'}` : null,
      body.fieldOverrides !== undefined ? `${Object.keys(cat.fieldOverrides).length} field change(s)` : null,
    ].filter(Boolean).join(', ');
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'TransportCategory',
      entityId: cat.category, entityName: cat.title, action: 'UPDATE',
      details: `Transport catalogue — ${cat.title}: ${changes}`,
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
  if (!isTransportCategory(body.category)) {
    return NextResponse.json({ ok: false, error: 'Unknown Transport category.' }, { status: 400 });
  }
  try {
    const cat = await getTenantCategory(auth.tenantId, body.category);
    const result = validateRequestValues(cat.effectiveForm, body.values);
    return NextResponse.json({ ok: true, valid: result.ok, errors: result.errors, values: result.values });
  } catch (err) {
    captureException(err, { context: 'customers.transport-catalog.check' });
    return NextResponse.json({ ok: false, error: 'Failed to check the request' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
export const POST = withAuditedAction(handlePOST);
