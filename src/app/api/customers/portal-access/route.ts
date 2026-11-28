export const dynamic = 'force-dynamic';

/**
 * Customer onboarding — which Customer Portals a customer gets.
 *
 * GET /api/customers/portal-access
 *   Every customer with its enabled portals (FSM, TRANSPORT), its Transport
 *   categories and portal user counts, plus the categories the tenant offers
 *   (Transport catalogue, including custom categories) and their titles.
 * PUT /api/customers/portal-access
 *   Body: { customerId, portal: 'FSM' | 'TRANSPORT', enabled, categories? }
 *   categories (TRANSPORT only): the Transport categories the customer may use.
 *   TENANT_ADMIN / SUPER_ADMIN only; audited.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import {
  PortalUserError, isCustomerPortal, listCustomerPortalSummaries, setCustomerPortalAccess,
} from '@/lib/customer-portal/users';
import { categoryLabel, parseTenantCategories } from '@/lib/customer-portal/catalog';
import { getTenantPortalEntitlements } from '@/lib/customer-portal/tenant-entitlements';
import { offeredCategories, tenantCategoryTitleMap } from '@/lib/transport-catalog/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  try {
    const [customers, offered, categoryLabels, entitlements] = await Promise.all([
      listCustomerPortalSummaries(auth.tenantId),
      offeredCategories(auth.tenantId),
      tenantCategoryTitleMap(auth.tenantId),
      getTenantPortalEntitlements(auth.tenantId),
    ]);
    return NextResponse.json({
      ok: true,
      customers,
      offeredCategories: offered,
      categoryLabels,
      enabledPortals: entitlements.enabledPortals,
      portalEntitlements: entitlements.portals,
      canEdit: requireAdmin(auth).ok,
    });
  } catch (err) {
    captureException(err, { context: 'customers.portal-access.list' });
    return NextResponse.json({ ok: false, error: 'Failed to load portal access' }, { status: 500 });
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
  const customerId = String(body.customerId ?? '');
  if (!customerId || !isCustomerPortal(body.portal) || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'customerId, portal (FSM | TRANSPORT) and enabled are required' }, { status: 400 });
  }
  const categories = body.categories === undefined ? undefined : parseTenantCategories(body.categories);
  if (categories === null || (categories && body.portal !== 'TRANSPORT')) {
    return NextResponse.json(
      { ok: false, error: 'categories must be a list of Transport categories (Transport portal only)' }, { status: 400 },
    );
  }
  try {
    await setCustomerPortalAccess(auth.tenantId, customerId, body.portal, body.enabled, auth.userId, categories);
    const titleMap = categories ? await tenantCategoryTitleMap(auth.tenantId) : undefined;
    const catText = categories
      ? ` (categories: ${categories.map((c) => categoryLabel(c, titleMap)).join(', ') || 'none'})` : '';
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'CustomerPortalAccess',
      entityId: customerId, entityName: body.portal, action: 'UPDATE',
      details: `${body.enabled ? 'Enabled' : 'Disabled'} the ${body.portal} Customer Portal for customer ${customerId}${catText}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PortalUserError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customers.portal-access.update' });
    return NextResponse.json({ ok: false, error: 'Failed to update portal access' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
