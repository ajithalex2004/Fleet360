import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT id, invoice_number, subtotal, vat_amount, total_amount,
                currency, payment_status, issue_date, due_date, line_items_json
           FROM platform_subscription_invoices
          WHERE id = $1::uuid AND tenant_id = $2
          LIMIT 1`,
        params.id,
        tenantId,
      ).catch(() => []);

      if (rows.length === 0) {
        return NextResponse.json({ error: 'Subscription invoice not found' }, { status: 404 });
      }

      return NextResponse.json({ ok: true, invoice: rows[0] });
    } catch {
      return NextResponse.json({ error: 'Subscription invoice not found' }, { status: 404 });
    }
  });
}
