export const dynamic = 'force-dynamic';

/**
 * POST /api/service-tickets/customers/[id]/assets
 *   Body: { name, customerSiteId?, assetNo?, serialNumber?, tagId?, description?, manufacturer?, model? }
 *   Registers a piece of customer equipment in the asset register, tagged to
 *   the customer (and site). An asset number CA-00001… is assigned when none
 *   is given. Returns the new asset.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { CustomerContextError, createCustomerAsset } from '@/lib/service-tickets/customer-context';

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
    const asset = await withTenantRls(prisma, tenantId, (tx) => createCustomerAsset(tx, tenantId, id, body));
    void logAudit({
      tenantId, userId: userId ?? undefined, entityType: 'CustomerAsset', entityId: asset.id, entityName: asset.assetNo,
      action: 'CREATE', details: `Registered customer equipment ${asset.assetNo} (${asset.name}) for customer ${id}`,
    });
    return NextResponse.json({ ok: true, asset }, { status: 201 });
  } catch (err) {
    if (err instanceof CustomerContextError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    captureException(err, { context: 'service-tickets.customers.assets.create' });
    return NextResponse.json({ ok: false, error: 'Failed to add the asset / equipment' }, { status: 500 });
  }
}
