export const dynamic = 'force-dynamic';

/**
 * POST /api/service-tickets/customers/[id]/sites
 *   Body: { name, code?, address?, city?, latitude?, longitude?, contactPerson?, contactMobile?, contactEmail? }
 *   Adds an entity / site to the customer (e.g. from the Service Request form,
 *   optionally pinned on the map). Returns the new site.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { CustomerContextError, createCustomerSite } from '@/lib/service-tickets/customer-context';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = stripTenantOwnershipFields(await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  try {
    const site = await withTenantRls(prisma, tenantId, (tx) => createCustomerSite(tx, tenantId, id, body));
    void logAudit({
      tenantId, userId: userId ?? undefined, entityType: 'CustomerSite', entityId: site.id, entityName: site.name,
      action: 'CREATE', details: `Added entity / site ${site.name} to customer ${id}`,
    });
    return NextResponse.json({ ok: true, site }, { status: 201 });
  } catch (err) {
    if (err instanceof CustomerContextError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    captureException(err, { context: 'service-tickets.customers.sites.create' });
    return NextResponse.json({ ok: false, error: 'Failed to add the entity / site' }, { status: 500 });
  }
}
