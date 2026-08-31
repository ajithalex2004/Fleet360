export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { backfillLegacyLogisticsBookings } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  let body: { limit?: number | string; dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* optional */ }

  try {
    const result = await backfillLegacyLogisticsBookings({
      tenantId,
      actorUserId: req.headers.get('x-user-id') ?? null,
      limit: body.limit == null ? 250 : Number(body.limit),
      dryRun: Boolean(body.dryRun),
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error('[logistics/shipments/backfill-legacy POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to backfill legacy bookings' },
      { status: 500 },
    );
  }
}
