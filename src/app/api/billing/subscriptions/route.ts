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
      // Query subscriptions for tenant
      const subscriptions = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, tenant_id, module_code, plan_tier, billing_cycle,
                base_price, currency, status, next_billing_date
           FROM tenant_module_subscriptions
          WHERE tenant_id = $1
          ORDER BY created_at DESC`,
        tenantId,
      );

      // Query isolated platform invoices (SUB-*)
      const platformInvoices = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, invoice_number, subtotal, vat_amount, total_amount,
                currency, payment_status, issue_date, due_date
           FROM platform_subscription_invoices
          WHERE tenant_id = $1
          ORDER BY created_at DESC`,
        tenantId,
      );

      return NextResponse.json({
        ok: true,
        subscriptions,
        platformInvoices,
      });
    });
  } catch (e) {
    console.error('[billing/subscriptions]', e);
    return NextResponse.json({ error: 'Failed to fetch subscriptions' }, { status: 500 });
  }
}
