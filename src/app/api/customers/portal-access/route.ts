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
import { parseFsmRequestTypes, type FsmPortalTypeOption } from '@/lib/customer-portal/fsm-types';
import { getTenantPortalEntitlements } from '@/lib/customer-portal/tenant-entitlements';
import { offeredCategories, tenantCategoryTitleMap } from '@/lib/transport-catalog/store';
import { loadRequestTypes } from '@/lib/service-tickets/request-types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  try {
    const [customers, offered, categoryLabels, entitlements, fsmMeta] = await Promise.all([
      listCustomerPortalSummaries(auth.tenantId),
      offeredCategories(auth.tenantId),
      tenantCategoryTitleMap(auth.tenantId),
      getTenantPortalEntitlements(auth.tenantId),
      loadRequestTypes(auth.tenantId).catch(() => null),
    ]);
    const availableFsmTypes: FsmPortalTypeOption[] = fsmMeta
      ? Object.entries(fsmMeta.typeConfig)
          .filter(([, cfg]) => cfg.catalogSla && !cfg.vehicleRequired)
          .sort((a, b) =>
            a[1].categoryName.localeCompare(b[1].categoryName) ||
            a[1].sortOrder - b[1].sortOrder ||
            a[1].name.localeCompare(b[1].name),
          )
          .map(([key, cfg]) => ({
            key,
            name: cfg.name,
            categoryKey: cfg.categoryKey,
            categoryName: cfg.categoryName,
            priority: cfg.defaultPriority,
          }))
      : [];
    return NextResponse.json({
      ok: true,
      customers,
      offeredCategories: offered,
      categoryLabels,
      availableFsmTypes,
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

  let scopedItems: string[] | undefined;
  if (body.portal === 'TRANSPORT') {
    const categories = body.categories === undefined ? undefined : parseTenantCategories(body.categories);
    if (categories === null || body.fsmTypes !== undefined) {
      return NextResponse.json(
        { ok: false, error: 'categories must be a list of Transport categories' }, { status: 400 },
      );
    }
    scopedItems = categories;
  } else {
    const rawFsm = body.fsmTypes !== undefined ? body.fsmTypes : body.categories;
    const fsmTypes = rawFsm === undefined ? undefined : parseFsmRequestTypes(rawFsm);
    if (fsmTypes === null) {
      return NextResponse.json(
        { ok: false, error: 'fsmTypes must be a list of valid Field Service request type keys' }, { status: 400 },
      );
    }
    scopedItems = fsmTypes;
  }

  try {
    await setCustomerPortalAccess(auth.tenantId, customerId, body.portal, body.enabled, auth.userId, scopedItems);
    let detailSuffix = '';
    if (body.portal === 'TRANSPORT' && scopedItems) {
      const titleMap = await tenantCategoryTitleMap(auth.tenantId);
      detailSuffix = ` (categories: ${scopedItems.map((c) => categoryLabel(c, titleMap)).join(', ') || 'none'})`;
    } else if (body.portal === 'FSM' && scopedItems !== undefined) {
      detailSuffix = scopedItems.length === 0
        ? ' (FSM request types: all enabled)'
        : ` (FSM request types: ${scopedItems.join(', ')})`;
    }
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'CustomerPortalAccess',
      entityId: customerId, entityName: body.portal, action: 'UPDATE',
      details: `${body.enabled ? 'Enabled' : 'Disabled'} the ${body.portal} Customer Portal for customer ${customerId}${detailSuffix}`,
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
