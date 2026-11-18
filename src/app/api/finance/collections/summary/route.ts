import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      // Sum genuine cash payments and applied credit notes separately
      const [sumRow] = await tx.$queryRawUnsafe<Array<{ total_cash: string | null; total_credit_notes: string | null }>>(
        `SELECT
           COALESCE(SUM(paid_amount), 0)::text AS total_cash,
           (SELECT COALESCE(SUM(COALESCE(applied_amount, total_amount)), 0)::text
              FROM finance_credit_notes
             WHERE tenant_id = $1
               AND deleted_at IS NULL
               AND status = 'APPLIED') AS total_credit_notes
         FROM finance_invoices
        WHERE tenant_id = $1 AND deleted_at IS NULL`,
        tenantId,
      );

      const cashCollected = Number(sumRow?.total_cash || 0);
      const creditNotesApplied = Number(sumRow?.total_credit_notes || 0);

      return NextResponse.json({
        ok: true,
        cashCollected,
        creditNotesApplied,
        totalSettlement: cashCollected + creditNotesApplied,
      });
    });
  } catch (e) {
    console.error('[finance/collections/summary]', e);
    return NextResponse.json({ error: 'Failed to compute collection summary' }, { status: 500 });
  }
}
