export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { getShipmentFinanceSummary, postFreightSettlementToFinance } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '200', 10) || 200, 1), 500);
  try {
    const data = await getShipmentFinanceSummary({ tenantId, limit });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
    console.error('[logistics/settlements GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load settlement summary' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  let body: { shipmentOrderId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.shipmentOrderId) {
    return NextResponse.json({ error: 'shipmentOrderId is required' }, { status: 400 });
  }

  try {
    const data = await postFreightSettlementToFinance({
      tenantId,
      shipmentOrderId: body.shipmentOrderId,
      actorUserId: req.headers.get('x-user-id') ?? null,
    });
    return NextResponse.json(data, { status: 201 });
    } catch (e) {
    console.error('[logistics/settlements POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to post settlement' },
      { status: 500 },
    );
  }
}
