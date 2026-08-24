/**
 * POST /api/bus-ops/route-consolidation/revert
 *
 * Undo a previously-applied consolidation. Runs its own guard cascade
 * (revert window + no-executed-trips + no-downstream + drift-hash +
 * restored-PCE) inside a Serializable transaction with SELECT FOR
 * UPDATE on the merged route.
 *
 * Body:
 *   { consolidationId: string, revertedBy?: string, revertReason?: string }
 *
 * Response:
 *   200 { status: 'REVERTED', consolidationId, sourcesReactivated, enrollmentsRestored }
 *   409 { status: 'BLOCKED', guards[] }
 *   500 on unexpected errors
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { revertConsolidation, type RevertConsolidationInput } from '@/lib/planning/route-consolidation-apply';
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
  if (!userId) return NextResponse.json({ error: 'x-user-id required for revert' }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
  const b = raw as Record<string, unknown>;

  // SECURITY: revertedBy and tenantId never come from the body. Reject
  // any client attempt loudly so the mistake surfaces immediately.
  if ('revertedBy' in b) {
    return NextResponse.json({ error: 'revertedBy is not accepted from the request body; the authenticated user is used automatically' }, { status: 400 });
  }
  if ('tenantId' in b) {
    return NextResponse.json({ error: 'tenantId is not accepted from the request body; the authenticated tenant context is used automatically' }, { status: 400 });
  }
  if (typeof b.consolidationId !== 'string' || !b.consolidationId) {
    return NextResponse.json({ error: 'consolidationId (string) is required' }, { status: 400 });
  }
  if (b.revertReason !== undefined && b.revertReason !== null && typeof b.revertReason !== 'string') {
    return NextResponse.json({ error: 'revertReason must be a string' }, { status: 400 });
  }

  const input: RevertConsolidationInput = {
    tenantId,
    consolidationId: b.consolidationId,
    revertedBy: userId,  // always the authenticated user
    revertReason: (b.revertReason as string | null) ?? undefined,
  };

  try {
    const result = await revertConsolidation(prisma, input);
    if (result.status === 'REVERTED') return NextResponse.json(result);
    return NextResponse.json(result, { status: 409 });
    } catch (e) {
    console.error('[route-consolidation.revert]', e);
    return NextResponse.json({ error: 'Revert failed' }, { status: 500 });
  }
}
