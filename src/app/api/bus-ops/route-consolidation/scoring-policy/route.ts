import { requireBusOpsRequest } from '@/lib/bus-ops/access';
export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/route-consolidation/scoring-policy
 *
 * GET  — resolved policy for the tenant (active DB row, else code default).
 * POST — activate a new policy version. Deactivates the current active row
 *        (effective-dated, not overwritten) and inserts the new one, so any
 *        RouteConsolidation.objectiveSnapshot captured under the old policy
 *        keeps describing a shape that still exists historically.
 *
 * Editing is restricted to users with bus-ops:edit on the
 * route-consolidation-scoring-policy resource — see
 * requireScoringPolicyEditPermission below.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import {
  resolveScoringPolicy,
  activateScoringPolicy,
  validateScoringPolicyInput,
  DEFAULT_SCORING_POLICY,
  type ScoringPolicyInput,
} from '@/lib/planning/route-consolidation-scoring-policy';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const permError = await requireBusOpsAdminAccess(req, 'route-consolidation');
  if (permError) return permError;

  try {
    const policy = await resolveScoringPolicy(prisma, tenantId);
    return NextResponse.json(policy);
  } catch (e) {
    console.error('[route-consolidation.scoring-policy.GET]', e);
    return NextResponse.json({ error: 'Failed to load scoring policy' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const policyError = await requireBusOpsRequest(req);
  if (policyError) return policyError;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const userId = req.headers.get('x-user-id') ?? null;

  const permError = await requireBusOpsAdminAccess(req, 'route-consolidation');
  if (permError) return permError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const err = validateScoringPolicyInput(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  try {
    const policy = await activateScoringPolicy(prisma, {
      tenantId,
      input: body as ScoringPolicyInput,
      calculationVersion: DEFAULT_SCORING_POLICY.calculationVersion,
      userId,
    });
    return NextResponse.json(policy, { status: 201 });
    } catch (e) {
    console.error('[route-consolidation.scoring-policy.POST]', e);
    return NextResponse.json({ error: 'Failed to activate scoring policy' }, { status: 500 });
  }
}
