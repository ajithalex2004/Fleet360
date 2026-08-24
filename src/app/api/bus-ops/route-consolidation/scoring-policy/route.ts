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
import { hasPermission, buildPermissionKey, SYSTEM_ROLES } from '@/lib/permissions';
import { requireBusOpsAdminAccess } from '@/lib/bus-ops/require-admin-access';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const permError = requireBusOpsAdminAccess(req, 'route-consolidation');
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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const userId = req.headers.get('x-user-id') ?? null;

  const permError = requireScoringPolicyEditPermission(req);
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

/**
 * Scoring weights change which candidates get recommended and applied —
 * higher stakes than most tenant config, so editing (not viewing) is
 * gated on bus-ops:edit, same boundary the rest of the app already uses
 * for module-level admin actions. middleware.ts sets x-user-role from the
 * session (defaulting to TENANT_ADMIN); we map that role to its granted
 * permission strings via SYSTEM_ROLES rather than trusting a client-sent
 * permissions list.
 *
 * Note: this is the first bus-ops API route to enforce RBAC server-side —
 * today's "Edit PCE rules" endpoint (/api/bus-ops/planning-constraints)
 * has no equivalent check, relying on UI-level hiding only. Scoring
 * weights change what gets recommended/applied across the whole tenant,
 * which is enough of a step up in blast radius to warrant enforcing here
 * even though it's not yet a universal pattern in this module.
 */
function requireScoringPolicyEditPermission(req: NextRequest): NextResponse | null {
  const roleCode = req.headers.get('x-user-role') ?? '';
  const perms = (SYSTEM_ROLES.find(r => r.code === roleCode)?.permissions ?? [])
    .map(p => buildPermissionKey(p.module, p.action, p.resource));
  if (!hasPermission(perms, 'bus-ops', 'edit', 'route-consolidation-scoring-policy')) {
    return NextResponse.json(
      { error: 'You do not have permission to edit the Route Consolidation scoring policy.' },
      { status: 403 },
    );
  }
  return null;
}
