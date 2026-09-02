export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { DisputeService } from '@/lib/exchange/dispute-service';

export const runtime = 'nodejs';

/**
 * GET /api/bus-ops/outsource/disputes
 * POST /api/bus-ops/outsource/disputes
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const partnerId = req.nextUrl.searchParams.get('partnerId') || undefined;
      const disputes = await DisputeService.listDisputes(tenantId, partnerId);
      return NextResponse.json({ disputes });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to fetch disputes' },
        { status: 500 }
      );
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const rawBody = await req.json().catch(() => ({}));
      const body = stripTenantOwnershipFields(rawBody);
      const { action } = body;

      if (action === 'RAISE_DISPUTE') {
        const { partnerId, invoiceId, invoiceItemId, disputedAmount, reason } = body;
        const dispute = await DisputeService.raiseDispute({
          tenantId,
          partnerId,
          invoiceId,
          invoiceItemId,
          disputedAmount: Number(disputedAmount),
          reason,
          raisedByUserId: userId || 'FINANCE',
        });
        return NextResponse.json({ ok: true, dispute });
      }

      if (action === 'RESOLVE_DISPUTE') {
        const { disputeId, resolution, resolvedAmount, creditNoteRef, resolutionNotes } = body;
        const dispute = await DisputeService.resolveDispute({
          tenantId,
          disputeId,
          resolution,
          resolvedAmount: resolvedAmount != null ? Number(resolvedAmount) : undefined,
          creditNoteRef,
          resolutionNotes,
          resolvedByUserId: userId || 'FINANCE',
        });
        return NextResponse.json({ ok: true, dispute });
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to process dispute' },
        { status: 500 }
      );
    }
  });
}
