/**
 * POST /api/bus-ops/merge-trips/preview
 *
 * Dry-run a merge — evaluate through PCE and return the verdict + a
 * lightweight preview (passenger count, capacity). Nothing is written.
 * The client typically calls this on a merge-dialog open to show the
 * operator whether the merge is legal before they hit Apply.
 *
 * Request body (see MergeInput):
 *   {
 *     sourceTripIds: string[],       // >=2 distinct
 *     merged: {
 *       routeId, vehicleId, driverId,
 *       departureTime, arrivalTime,  // ISO
 *       latestArrivalTime?,          // ISO
 *       stops: [{placeId, lat, lng, sequence}],
 *       notes?
 *     },
 *     tenantTimezone?: 'Asia/Dubai'
 *   }
 *
 * Response:
 *   200 { verdict, checks[], totalPenalty, preview }
 *   400 on structural / source-state guards (with error.code)
 *   Note: 200 with verdict='BLOCK' is still 200 — the client keys on
 *   the verdict, not the HTTP status, because BLOCK is a valid preview
 *   answer (not a request failure).
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { previewMerge } from '@/lib/bus-ops/merge-trips';
import { parseMergeInputBody } from '@/lib/bus-ops/merge-trips-body';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = parseMergeInputBody(body, tenantId);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await previewMerge(prisma, parsed.input);
    if ('code' in result) {
      return NextResponse.json({ error: result.message, code: result.code, details: result.details }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error('[merge-trips.preview]', e);
    return NextResponse.json({ error: 'Merge preview failed' }, { status: 500 });
  }
}
