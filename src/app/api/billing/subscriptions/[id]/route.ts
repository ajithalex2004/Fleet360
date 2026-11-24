import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid subscription invoice ID format' }, { status: 400 });
  }

  try {
    return await withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, invoice_number, subtotal, vat_amount, total_amount,
                currency, payment_status, issue_date, due_date, line_items_json
           FROM platform_subscription_invoices
          WHERE id = $1::uuid AND tenant_id = $2
          LIMIT 1`,
        params.id,
        tenantId,
      );

      if (rows.length === 0) {
        return NextResponse.json({ error: 'Subscription invoice not found' }, { status: 404 });
      }

      return NextResponse.json({ ok: true, invoice: rows[0] });
    });
  } catch (e) {
    console.error('[billing/subscriptions/[id] GET]', e);
    return NextResponse.json({ error: 'Failed to fetch subscription invoice' }, { status: 500 });
  }
}
