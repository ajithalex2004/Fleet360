import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      // Sum genuine cash payments (excluding credit note allocations)
      const [sumRow] = await tx.$queryRawUnsafe<Array<{ total_cash: string | null; total_credit_notes: string | null }>>(
        `SELECT
           COALESCE(SUM(paid_amount), 0)::text AS total_cash,
           (SELECT COALESCE(SUM(allocated_amount), 0)::text
              FROM finance_payment_allocations
             WHERE tenant_id = $1 AND source_type = 'CREDIT_NOTE') AS total_credit_notes
         FROM finance_invoices
        WHERE tenant_id = $1 AND deleted_at IS NULL`,
        tenantId,
      ).catch(() => [{ total_cash: '0', total_credit_notes: '0' }]);

      const cashCollected = Number(sumRow?.total_cash || 0);
      const creditNotesApplied = Number(sumRow?.total_credit_notes || 0);

      return NextResponse.json({
        ok: true,
        cashCollected,
        creditNotesApplied,
        totalSettlement: cashCollected + creditNotesApplied,
      });
    } catch (e) {
      console.error('[finance/collections/summary]', e);
      return NextResponse.json({ error: 'Failed to compute collection summary' }, { status: 500 });
    }
  });
}
