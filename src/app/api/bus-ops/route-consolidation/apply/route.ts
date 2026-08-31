export const dynamic = 'force-dynamic';

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
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { applyConsolidation, type ApplyConsolidationInput } from '@/lib/planning/route-consolidation-apply';
import { parseApplyBody } from '@/lib/bus-ops/route-consolidation-apply-body';
import { resolveScoringPolicy } from '@/lib/planning/route-consolidation-scoring-policy';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const permError = requireBusOpsAdminAccess(req, 'route-consolidation');
  if (permError) return permError;
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

  // Snapshot the scoring policy INTO objectiveSnapshot here, server-side,
  // rather than trusting whatever the client sent — the apply-time
  // policy must be authoritative for reproducibility, and re-resolving
  // it fresh (rather than accepting client-submitted weights) means a
  // tampered request body can't silently rewrite what gets audited.
  // Analyse itself never persists this; only Apply does.
  const scoringPolicy = await resolveScoringPolicy(prisma, tenantId).catch(() => null);
  const input = parsed.input as ApplyConsolidationInput;
  if (scoringPolicy) {
    input.objective = {
      ...(input.objective ?? {}),
      scoringPolicy: {
        id: scoringPolicy.id,
        name: scoringPolicy.name,
        calculationVersion: scoringPolicy.calculationVersion,
        references: scoringPolicy.references,
        benefitWeights: scoringPolicy.benefitWeights,
        impactWeights: scoringPolicy.impactWeights,
      },
    };
  }

  try {
    const result = await applyConsolidation(prisma, input);
    if (result.status === 'APPLIED')       return NextResponse.json(result, { status: 201 });
    if (result.status === 'ALREADY_APPLIED') return NextResponse.json(result, { status: 200 });
    return NextResponse.json(result, { status: 409 }); // BLOCKED
  } catch (e) {
    console.error('[route-consolidation.apply]', e);
    return NextResponse.json({ error: 'Apply failed' }, { status: 500 });
  }
}
