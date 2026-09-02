export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { SettlementService } from '@/lib/exchange/settlement-service';
import { SettlementReconciliationService } from '@/lib/exchange/reconciliation-service';

export const runtime = 'nodejs';

/**
 * GET /api/bus-ops/outsource/settlements
 * POST /api/bus-ops/outsource/settlements
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
      const statements = await SettlementService.listStatements(tenantId, partnerId);
      return NextResponse.json({ statements });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to fetch settlement statements' },
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

      if (action === 'RECONCILE_INVOICE') {
        const { invoiceId } = body;
        const result = await SettlementReconciliationService.performThreeWayMatch(invoiceId);
        return NextResponse.json({ ok: true, reconciliation: result });
      }

      if (action === 'GENERATE_STATEMENT') {
        const { partnerId, periodStart, periodEnd, appliedDeductions } = body;
        const result = await SettlementService.generateSettlementStatement({
          tenantId,
          partnerId,
          periodStart,
          periodEnd,
          appliedDeductions,
          createdByUserId: userId || 'FINANCE',
        });
        return NextResponse.json({ ok: true, ...result });
      }

      if (action === 'APPROVE_STATEMENT') {
        const { statementId } = body;
        const result = await SettlementService.approveSettlementStatement(statementId, tenantId, userId || 'FINANCE');
        return NextResponse.json(result);
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to process settlement operation' },
        { status: 500 }
      );
    }
  });
}
