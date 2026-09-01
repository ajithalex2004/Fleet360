export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/adhoc-requests
 *
 * GET  - Lists adhoc requests with evaluated fulfillment options
 * POST - Submits a new adhoc / overtime transport request
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  createAdhocTransportRequest,
  getTenantAdhocRequests,
  type AdhocRequestInput,
} from '@/lib/bus-ops/adhoc-dispatch';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId } = authz;
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') || undefined;
  const staffMemberId = sp.get('staffMemberId') || undefined;

  try {
    const requests = await getTenantAdhocRequests(tenantId, {
      status,
      staffMemberId,
    });

    return NextResponse.json(requests, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err) {
    console.error('[api/bus-ops/adhoc-requests GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch adhoc requests' },
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
  const rawBody = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(rawBody);

  const { staffMemberId, tripDate, pickupLocation, dropLocation, reason, notes } = body;

  if (!staffMemberId || !tripDate || !pickupLocation || !dropLocation || !reason) {
    return NextResponse.json(
      { error: 'staffMemberId, tripDate, pickupLocation, dropLocation, and reason are required' },
      { status: 400 },
    );
  }

  try {
    const input: AdhocRequestInput = {
      staffMemberId,
      tripDate,
      pickupLocation,
      dropLocation,
      reason,
      notes,
    };

    const request = await createAdhocTransportRequest(tenantId, input);

    return NextResponse.json({
      ok: true,
      message: `Ad-hoc transport request ${request.requestNo} submitted successfully`,
      request,
    });
  } catch (err) {
    console.error('[api/bus-ops/adhoc-requests POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create adhoc transport request' },
      { status: 500 },
    );
  }
}
