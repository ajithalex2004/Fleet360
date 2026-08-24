/**
 * POST /api/bus-ops/route-consolidation/apply/preview
 *
 * Read-only dry-run of a Route Consolidation apply. Returns the full
 * guard cascade result + enrollment migration plan + PCE re-evaluation.
 * Nothing is written.
 *
 * The client uses this to render the confirmation modal in PR 3: the
 * operator sees which enrollments will move, which stops require
 * manual resolution, whether PCE still passes, and clicks Apply (or
 * fixes and re-previews).
 *
 * Body:
 *   {
 *     recommendationId: string,
 *     sourceRouteIds: string[],
 *     mergedRoute: { name?, stopIds[], ... },
 *     sourceRouteFingerprints?: { routeId: updatedAtISO },
 *     operatorResolutions?: { "RP:id"|"TE:id": { pickupStopId?, dropoffStopId? } },
 *     objective?: object
 *   }
 *
 * Response 200:
 *   { overallVerdict: 'READY' | 'BLOCKED', guards[], enrollmentMigrations[], pce }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { previewApply, type PreviewApplyInput } from '@/lib/planning/route-consolidation-apply';
import { parseApplyBody } from '@/lib/bus-ops/route-consolidation-apply-body';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = parseApplyBody(raw, tenantId, { requireIdempotencyKey: false });
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await previewApply(prisma, parsed.input as PreviewApplyInput);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[route-consolidation.apply.preview]', e);
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 });
  }
}
