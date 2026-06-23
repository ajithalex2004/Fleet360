import { NextRequest, NextResponse } from 'next/server';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { buildCustomerStatement } from '@/lib/finance/customer-statement';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ctx = requireOperationalContext(req, 'finance', { requestedTenantId: sp.get('tenantId') });
  if (ctx instanceof NextResponse) return ctx;

  const customerKey = sp.get('customer');
  const includeInactive = sp.get('includeInactive') === 'true';
  const view = sp.get('view') === 'outstanding' ? 'outstanding' : 'ledger';
  const from = sp.get('from') ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = sp.get('to') ?? new Date().toISOString().slice(0, 10);
  const moduleFilter = sp.get('module');
  const branch = sp.get('branch');

  const statement = await buildCustomerStatement({
    tenantId: ctx.tenantId,
    customerKey,
    includeInactive,
    view,
    from,
    to,
    module: moduleFilter,
    branch,
  });

  if (customerKey && !statement) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  }

  return NextResponse.json(statement);
}
