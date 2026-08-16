/**
 * POST /api/bus-ops/route-consolidation/apply
 *
 * Commits a Route Consolidation. Runs the guard cascade authoritatively
 * inside a Serializable transaction, with SELECT FOR UPDATE on source
 * routes. Idempotent via UNIQUE(tenantId, idempotencyKey) — a retry
 * with the same key returns ALREADY_APPLIED.
 *
 * Body: PreviewApplyInput + { idempotencyKey, appliedBy, recommendationSnapshot? }
 *
 * Response:
 *   201 { status: 'APPLIED', consolidationId, mergedRouteId, ... }
 *   200 { status: 'ALREADY_APPLIED', consolidationId, mergedRouteId, priorStatus }
 *   409 { status: 'BLOCKED', guards[], enrollmentMigrations[], pce }
 *   500 on unexpected errors
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyConsolidation, type ApplyConsolidationInput } from '@/lib/planning/route-consolidation-apply';
import { parseApplyBody } from '@/lib/bus-ops/route-consolidation-apply-body';

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'x-user-id required for apply' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  // appliedBy comes from the authenticated x-user-id header, NEVER
  // from the request body. The parser rejects any body attempt.
  const parsed = parseApplyBody(raw, tenantId, { requireIdempotencyKey: true, appliedBy: userId });
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await applyConsolidation(prisma, parsed.input as ApplyConsolidationInput);
    if (result.status === 'APPLIED')       return NextResponse.json(result, { status: 201 });
    if (result.status === 'ALREADY_APPLIED') return NextResponse.json(result, { status: 200 });
    return NextResponse.json(result, { status: 409 }); // BLOCKED
  } catch (e) {
    console.error('[route-consolidation.apply]', e);
    return NextResponse.json({ error: 'Apply failed' }, { status: 500 });
  }
}
